package ws

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Hub struct {
	clients       map[uuid.UUID]*Client
	broadcast     chan Message
	readStatus    chan ReadStatus
	deliveryStatus chan DeliveryStatus
	register      chan *Client
	unregister    chan *Client
	mu            sync.RWMutex
}

type Message struct {
	ID         uuid.UUID `json:"id"`
	SenderID   uuid.UUID `json:"sender_id"`
	ReceiverID uuid.UUID `json:"receiver_id"`
	Payload    string    `json:"payload"`
	CreatedAt  time.Time `json:"created_at"`
}

type ReadStatus struct {
	Type      string    `json:"type"`
	ReaderID  uuid.UUID `json:"reader_id"`
	PartnerID uuid.UUID `json:"partner_id"`
}

type DeliveryStatus struct {
	Type       string    `json:"type"`
	MessageID  uuid.UUID `json:"message_id"`
	SenderID   uuid.UUID `json:"sender_id"`
	ReceiverID uuid.UUID `json:"receiver_id"`
}

func NewHub() *Hub {
	return &Hub{
		clients:        make(map[uuid.UUID]*Client),
		broadcast:      make(chan Message, 256),
		readStatus:     make(chan ReadStatus, 256),
		deliveryStatus: make(chan DeliveryStatus, 256),
		register:       make(chan *Client),
		unregister:     make(chan *Client),
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

		case status := <-h.readStatus:
			h.mu.RLock()
			partner, ok := h.clients[status.PartnerID]
			h.mu.RUnlock()

			if ok {
				select {
				case partner.sendReadStatus <- status:
				default:
				}
			}

		case status := <-h.deliveryStatus:
			h.mu.RLock()
			sender, ok := h.clients[status.SenderID]
			h.mu.RUnlock()

			if ok {
				select {
				case sender.sendDeliveryStatus <- status:
				default:
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

func (h *Hub) SendReadStatus(status ReadStatus) {
	select {
	case h.readStatus <- status:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendDeliveryStatus(status DeliveryStatus) {
	select {
	case h.deliveryStatus <- status:
	case <-time.After(time.Second):
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}
