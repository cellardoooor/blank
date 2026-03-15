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
		return true // Allow all origins for cloud deployment
	},
}

type Client struct {
	hub                *Hub
	conn               *websocket.Conn
	send               chan Message
	sendReadStatus     chan ReadStatus
	sendDeliveryStatus chan DeliveryStatus
	sendTypingStatus   chan TypingStatus
	sendCallStart      chan CallStart
	sendCallOffer      chan CallOffer
	sendCallAnswer     chan CallAnswer
	sendCallIceCandidate chan CallIceCandidate
	sendCallJoin       chan CallJoin
	sendCallLeave      chan CallLeave
	sendCallEnd        chan CallEnd
	sendCallReject     chan CallReject
	userID             uuid.UUID
	messageService     *service.MessageService
	userService        *service.UserService
	callSignaling      *CallSignaling
}

type Handler struct {
	hub            *Hub
	authService    *auth.Service
	messageService *service.MessageService
	userService    *service.UserService
	callSignaling  *CallSignaling
}

func NewHandler(hub *Hub, authSvc *auth.Service, msgSvc *service.MessageService, userSvc *service.UserService, callSig *CallSignaling) *Handler {
	return &Handler{
		hub:            hub,
		authService:    authSvc,
		messageService: msgSvc,
		userService:    userSvc,
		callSignaling:  callSig,
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
		hub:                  h.hub,
		conn:                 conn,
		send:                 make(chan Message, 256),
		sendReadStatus:       make(chan ReadStatus, 256),
		sendDeliveryStatus:   make(chan DeliveryStatus, 256),
		sendTypingStatus:     make(chan TypingStatus, 256),
		sendCallStart:        make(chan CallStart, 256),
		sendCallOffer:        make(chan CallOffer, 256),
		sendCallAnswer:       make(chan CallAnswer, 256),
		sendCallIceCandidate: make(chan CallIceCandidate, 256),
		sendCallJoin:         make(chan CallJoin, 256),
		sendCallLeave:        make(chan CallLeave, 256),
		sendCallEnd:          make(chan CallEnd, 256),
		sendCallReject:       make(chan CallReject, 256),
		userID:               userID,
		messageService:       h.messageService,
		userService:          h.userService,
		callSignaling:        h.callSignaling,
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
				log.Printf("websocket error: %v", err)
			}
			break
		}

		var rawMsg map[string]interface{}
		if err := json.Unmarshal(data, &rawMsg); err != nil {
			log.Printf("failed to unmarshal message: %v", err)
			continue
		}

		if msgType, ok := rawMsg["type"].(string); ok && msgType == "read" {
			partnerIDStr, ok := rawMsg["partner_id"].(string)
			if !ok {
				continue
			}
			partnerID, err := uuid.Parse(partnerIDStr)
			if err != nil {
				continue
			}

			if c.messageService != nil {
				ctx := context.Background()
				if err := c.messageService.MarkChatAsRead(ctx, c.userID, partnerID); err != nil {
					log.Printf("failed to mark as read: %v", err)
					go c.retryMarkAsRead(partnerID, 3)
				}
			}

			c.hub.SendReadStatus(ReadStatus{
				Type:      "read",
				ReaderID:  c.userID,
				PartnerID: partnerID,
			})
			continue
		}

		if msgType, ok := rawMsg["type"].(string); ok && msgType == "delivered" {
			messageIDStr, ok := rawMsg["message_id"].(string)
			if !ok {
				continue
			}
			messageID, err := uuid.Parse(messageIDStr)
			if err != nil {
				continue
			}

			if c.messageService != nil {
				ctx := context.Background()
				if err := c.messageService.MarkMessageAsDelivered(ctx, messageID, c.userID); err != nil {
					log.Printf("failed to mark as delivered: %v", err)
				}
			}
			continue
		}

		if msgType, ok := rawMsg["type"].(string); ok && msgType == "typing" {
			receiverIDStr, ok := rawMsg["receiver_id"].(string)
			if !ok {
				continue
			}
			receiverID, err := uuid.Parse(receiverIDStr)
			if err != nil {
				continue
			}

			text, _ := rawMsg["text"].(string)

			c.hub.SendTypingStatus(TypingStatus{
				Type:       "typing",
				SenderID:   c.userID,
				ReceiverID: receiverID,
				Text:       text,
			})
			continue
		}

		// Call signaling messages
		if msgType, ok := rawMsg["type"].(string); ok {
			switch msgType {
			case "call_start":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallStart(c, data)
				}
				continue
			case "call_offer":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallOffer(c, data)
				}
				continue
			case "call_answer":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallAnswer(c, data)
				}
				continue
			case "call_ice_candidate":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallIceCandidate(c, data)
				}
				continue
			case "call_join":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallJoin(c, data)
				}
				continue
			case "call_leave":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallLeave(c, data)
				}
				continue
			case "call_end":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallEnd(c, data)
				}
				continue
			case "call_reject":
				if c.callSignaling != nil {
					c.callSignaling.HandleCallReject(c, data)
				}
				continue
			}
		}

		var msg Message
		if err := json.Unmarshal(data, &msg); err != nil {
			log.Printf("failed to unmarshal message: %v", err)
			continue
		}

		msg.ID = uuid.New()
		msg.SenderID = c.userID
		msg.CreatedAt = time.Now()

		// Check for @all broadcast message
		if strings.HasPrefix(msg.Payload, "@all ") {
			c.handleBroadcastMessage(msg)
			continue
		}

		// Save message to database (convert string to []byte)
		if c.messageService != nil {
			ctx := context.Background()
			savedMsg, err := c.messageService.Send(ctx, c.userID, msg.ReceiverID, []byte(msg.Payload))
			if err != nil {
				log.Printf("failed to save message: %v", err)
				continue
			}
			msg.ID = savedMsg.ID
		}

		// Send delivery confirmation to sender
		c.hub.SendDeliveryStatus(DeliveryStatus{
			Type:       "delivered",
			MessageID:  msg.ID,
			SenderID:   c.userID,
			ReceiverID: msg.ReceiverID,
		})

		c.hub.Broadcast(msg)
	}
}

func (c *Client) retryMarkAsRead(partnerID uuid.UUID, maxRetries int) {
	for i := 0; i < maxRetries; i++ {
		time.Sleep(time.Duration(i+1) * 500 * time.Millisecond)
		
		if c.messageService != nil {
			ctx := context.Background()
			if err := c.messageService.MarkChatAsRead(ctx, c.userID, partnerID); err != nil {
				log.Printf("retry %d failed to mark as read: %v", i+1, err)
				continue
			}
			
			c.hub.SendReadStatus(ReadStatus{
				Type:      "read",
				ReaderID:  c.userID,
				PartnerID: partnerID,
			})
			return
		}
	}
}

// handleBroadcastMessage handles @all messages from admin users
// Broadcasts the message to all users without saving to database
func (c *Client) handleBroadcastMessage(msg Message) {
	// Get sender info to check if admin
	if c.messageService == nil {
		return
	}

	ctx := context.Background()
	sender, err := c.messageService.GetSenderInfo(ctx, c.userID)
	if err != nil {
		log.Printf("failed to get sender info: %v", err)
		return
	}

	// Only admin can broadcast
	if sender.Username != "admin" {
		log.Printf("non-admin user %s attempted to broadcast", sender.Username)
		return
	}

	// Get all users
	users, err := c.userService.GetAll(ctx)
	if err != nil {
		log.Printf("failed to get users for broadcast: %v", err)
		return
	}

	// Remove "@all " prefix from payload
	broadcastPayload := strings.TrimPrefix(msg.Payload, "@all ")

	// Send to all users except sender
	for _, user := range users {
		if user.ID == c.userID {
			continue
		}

		broadcastMsg := Message{
			ID:         uuid.New(),
			SenderID:   c.userID,
			ReceiverID: user.ID,
			Payload:    broadcastPayload,
			CreatedAt:  msg.CreatedAt,
		}

		c.hub.Broadcast(broadcastMsg)
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
				Payload    string    `json:"payload"`
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

		case status := <-c.sendReadStatus:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(status)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case status := <-c.sendDeliveryStatus:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(status)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case typing := <-c.sendTypingStatus:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(typing)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case start := <-c.sendCallStart:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(start)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case offer := <-c.sendCallOffer:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(offer)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case answer := <-c.sendCallAnswer:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(answer)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case ice := <-c.sendCallIceCandidate:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(ice)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case join := <-c.sendCallJoin:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(join)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case leave := <-c.sendCallLeave:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(leave)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case end := <-c.sendCallEnd:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(end)
			if err != nil {
				continue
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}

		case reject := <-c.sendCallReject:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			data, err := json.Marshal(reject)
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
