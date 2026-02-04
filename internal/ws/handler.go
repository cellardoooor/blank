package ws

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"messenger/internal/auth"
	"messenger/internal/service"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		if origin == "" {
			return true
		}
		// Allow same origin
		return strings.HasPrefix(origin, "http://localhost:8080") || strings.HasPrefix(origin, "http://127.0.0.1:8080")
	},
}

type Client struct {
	hub            *Hub
	conn           *websocket.Conn
	send           chan Message
	userID         uuid.UUID
	messageService *service.MessageService
}

type Handler struct {
	hub            *Hub
	authService    *auth.Service
	messageService *service.MessageService
}

func NewHandler(hub *Hub, authSvc *auth.Service, msgSvc *service.MessageService) *Handler {
	return &Handler{
		hub:            hub,
		authService:    authSvc,
		messageService: msgSvc,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token required", http.StatusUnauthorized)
		return
	}

	userID, err := h.authService.ValidateToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &Client{
		hub:            h.hub,
		conn:           conn,
		send:           make(chan Message, 256),
		userID:         userID,
		messageService: h.messageService,
	}

	h.hub.Register(client)

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.Unregister(c)
		c.conn.Close()
	}()

	c.conn.SetReadLimit(512 * 1024)
	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
			}
			break
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		msg.ID = uuid.New()
		msg.SenderID = c.userID
		msg.CreatedAt = time.Now()

		// Save message to database
		if c.messageService != nil {
			ctx := context.Background()
			_, err := c.messageService.Send(ctx, c.userID, msg.ReceiverID, msg.Payload)
			if err != nil {
				log.Printf("failed to save message: %v", err)
			}
		}

		c.hub.Broadcast(msg)
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// Convert to API message format
			apiMsg := struct {
				ID         uuid.UUID `json:"id"`
				SenderID   uuid.UUID `json:"sender_id"`
				ReceiverID uuid.UUID `json:"receiver_id"`
				Payload    []byte    `json:"payload"`
				CreatedAt  string    `json:"created_at"`
			}{
				ID:         msg.ID,
				SenderID:   msg.SenderID,
				ReceiverID: msg.ReceiverID,
				Payload:    msg.Payload,
				CreatedAt:  msg.CreatedAt.Format(time.RFC3339),
			}

			data, err := json.Marshal(apiMsg)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) UserID() uuid.UUID {
	return c.userID
}
