package ws

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Hub struct {
	clients    map[uuid.UUID]*Client
	broadcast  chan Message
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

type Message struct {
	ID         uuid.UUID `json:"id"`
	SenderID   uuid.UUID `json:"sender_id"`
	ReceiverID uuid.UUID `json:"receiver_id"`
	Payload    string    `json:"payload"`
	CreatedAt  time.Time `json:"created_at"`
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[uuid.UUID]*Client),
		broadcast:  make(chan Message, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client.userID] = client
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.userID]; ok {
				delete(h.clients, client.userID)
				close(client.send)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			// Send to receiver
			receiver, receiverOK := h.clients[msg.ReceiverID]
			// Send to sender (for confirmation with real ID and timestamp)
			sender, senderOK := h.clients[msg.SenderID]
			h.mu.RUnlock()

			if receiverOK {
				select {
				case receiver.send <- msg:
				default:
					h.mu.Lock()
					close(receiver.send)
					delete(h.clients, receiver.userID)
					h.mu.Unlock()
				}
			}

			if senderOK && msg.SenderID != msg.ReceiverID {
				select {
				case sender.send <- msg:
				default:
					h.mu.Lock()
					close(sender.send)
					delete(h.clients, sender.userID)
					h.mu.Unlock()
				}
			}
		}
	}
}

func (h *Hub) Broadcast(msg Message) {
	select {
	case h.broadcast <- msg:
	case <-time.After(time.Second):
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}
