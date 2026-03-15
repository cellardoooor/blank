package ws

import (
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

type Hub struct {
	clients        map[uuid.UUID]*Client
	broadcast      chan Message
	readStatus     chan ReadStatus
	deliveryStatus chan DeliveryStatus
	typingStatus     chan TypingStatus
	callStart        chan CallStart
	callOffer        chan CallOffer
	callAnswer       chan CallAnswer
	callIceCandidate chan CallIceCandidate
	callJoin         chan CallJoin
	callLeave        chan CallLeave
	callEnd          chan CallEnd
	callReject       chan CallReject
	register         chan *Client
	unregister       chan *Client
	mu               sync.RWMutex
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

type TypingStatus struct {
	Type       string    `json:"type"`
	SenderID   uuid.UUID `json:"sender_id"`
	ReceiverID uuid.UUID `json:"receiver_id"`
	Text       string    `json:"text"`
}

type CallStart struct {
	Type         string    `json:"type"`
	CallID       uuid.UUID `json:"call_id"`
	CallType     string    `json:"call_type"`
	Participants []uuid.UUID `json:"participants"`
	CallerID     uuid.UUID `json:"caller_id"`
}

type CallOffer struct {
	Type         string      `json:"type"`
	CallID       uuid.UUID   `json:"call_id"`
	CallerID     uuid.UUID   `json:"caller_id"`
	SDP          string      `json:"sdp"`
	CallType     string      `json:"call_type"`
	Participants []uuid.UUID `json:"participants"`
}

type CallAnswer struct {
	Type     string    `json:"type"`
	CallID   uuid.UUID `json:"call_id"`
	CalleeID uuid.UUID `json:"callee_id"`
	SDP      string    `json:"sdp"`
}

type CallIceCandidate struct {
	Type        string    `json:"type"`
	CallID      uuid.UUID `json:"call_id"`
	UserID      uuid.UUID `json:"user_id"`
	TargetUserID uuid.UUID `json:"target_user_id"`
	Candidate   string    `json:"candidate"`
}

type CallJoin struct {
	Type     string    `json:"type"`
	CallID   uuid.UUID `json:"call_id"`
	UserID   uuid.UUID `json:"user_id"`
}

type CallLeave struct {
	Type     string    `json:"type"`
	CallID   uuid.UUID `json:"call_id"`
	UserID   uuid.UUID `json:"user_id"`
}

type CallEnd struct {
	Type     string    `json:"type"`
	CallID   uuid.UUID `json:"call_id"`
	UserID   uuid.UUID `json:"user_id"`
}

type CallReject struct {
	Type     string    `json:"type"`
	CallID   uuid.UUID `json:"call_id"`
	UserID   uuid.UUID `json:"user_id"`
}

func NewHub() *Hub {
	return &Hub{
		clients:          make(map[uuid.UUID]*Client),
		broadcast:        make(chan Message, 256),
		readStatus:       make(chan ReadStatus, 256),
		deliveryStatus:   make(chan DeliveryStatus, 256),
		typingStatus:     make(chan TypingStatus, 256),
		callStart:        make(chan CallStart, 256),
		callOffer:        make(chan CallOffer, 256),
		callAnswer:       make(chan CallAnswer, 256),
		callIceCandidate: make(chan CallIceCandidate, 256),
		callJoin:         make(chan CallJoin, 256),
		callLeave:        make(chan CallLeave, 256),
		callEnd:          make(chan CallEnd, 256),
		callReject:       make(chan CallReject, 256),
		register:         make(chan *Client),
		unregister:       make(chan *Client),
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
			sender, senderOk := h.clients[status.ReaderID]
			h.mu.RUnlock()

			if ok {
				select {
				case partner.sendReadStatus <- status:
				default:
				}
			}

			if senderOk && status.ReaderID != status.PartnerID {
				select {
				case sender.sendReadStatus <- status:
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

		case typing := <-h.typingStatus:
			h.mu.RLock()
			receiver, receiverOK := h.clients[typing.ReceiverID]
			h.mu.RUnlock()

			if receiverOK {
				select {
				case receiver.sendTypingStatus <- typing:
				default:
				}
			}

		case start := <-h.callStart:
			// Use SendToParticipantsExcluding to avoid sending call_start back to the caller
			// The caller already receives a separate call_start with their participant info
			h.SendToParticipantsExcluding(start.Participants, start.CallerID, func(c *Client) interface{} { return start })

		case offer := <-h.callOffer:
			// Use SendToParticipantsExcluding to avoid sending offer back to the sender
			h.SendToParticipantsExcluding(offer.Participants, offer.CallerID, func(c *Client) interface{} { return offer })

		case answer := <-h.callAnswer:
			h.SendToClient(answer.CallerID, func(c *Client) interface{} { return answer })

		case ice := <-h.callIceCandidate:
			// Route ICE candidate to the target user (the peer), not the sender
			h.SendToClient(ice.TargetUserID, func(c *Client) interface{} { return ice })

		case join := <-h.callJoin:
			h.SendToClient(join.UserID, func(c *Client) interface{} { return join })

		case leave := <-h.callLeave:
			h.SendToClient(leave.UserID, func(c *Client) interface{} { return leave })

		case end := <-h.callEnd:
			h.SendToClient(end.UserID, func(c *Client) interface{} { return end })

		case reject := <-h.callReject:
			h.SendToClient(reject.UserID, func(c *Client) interface{} { return reject })
		}
	}
}

// SendToClient sends a message to a single client by userID
// Exported for use by CallSignaling in call_signaling.go
func (h *Hub) SendToClient(userID uuid.UUID, getMsg func(*Client) interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if client, ok := h.clients[userID]; ok {
		h.sendToClientChan(client, getMsg(client))
	}
}

// sendToParticipants sends a message to multiple participants
func (h *Hub) sendToParticipants(userIDs []uuid.UUID, getMsg func(*Client) interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, pid := range userIDs {
		if client, ok := h.clients[pid]; ok {
			h.sendToClientChan(client, getMsg(client))
		}
	}
}

// SendToParticipantsExcluding sends a message to multiple participants except the excluded user
// This is useful for broadcast scenarios where the sender should not receive their own message
// Exported for use by CallSignaling in call_signaling.go
func (h *Hub) SendToParticipantsExcluding(userIDs []uuid.UUID, excludeUserID uuid.UUID, getMsg func(*Client) interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, pid := range userIDs {
		if pid == excludeUserID {
			continue
		}
		if client, ok := h.clients[pid]; ok {
			h.sendToClientChan(client, getMsg(client))
		}
	}
}

// sendToClientChan sends a message to a client's channel based on message type
// Uses a helper function to reduce repetitive non-blocking send pattern
// WARNING: Unknown message types are logged and dropped - ensure all message types are registered
func (h *Hub) sendToClientChan(client *Client, msg interface{}) {
	switch m := msg.(type) {
	case CallStart:
		trySend(client.sendCallStart, m)
	case CallOffer:
		trySend(client.sendCallOffer, m)
	case CallAnswer:
		trySend(client.sendCallAnswer, m)
	case CallIceCandidate:
		trySend(client.sendCallIceCandidate, m)
	case CallJoin:
		trySend(client.sendCallJoin, m)
	case CallLeave:
		trySend(client.sendCallLeave, m)
	case CallEnd:
		trySend(client.sendCallEnd, m)
	case CallReject:
		trySend(client.sendCallReject, m)
	default:
		// This indicates a programming error - a new message type was added
		// without updating this switch statement. The message is dropped.
		log.Printf("WARNING: unknown message type in sendToClientChan: %T - message dropped for user %s", msg, client.userID)
	}
}

// trySend performs a non-blocking send to a channel
func trySend[T any](ch chan<- T, msg T) {
	select {
	case ch <- msg:
	default:
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

func (h *Hub) SendTypingStatus(status TypingStatus) {
	select {
	case h.typingStatus <- status:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallStart(start CallStart) {
	select {
	case h.callStart <- start:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallOffer(offer CallOffer) {
	select {
	case h.callOffer <- offer:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallAnswer(answer CallAnswer) {
	select {
	case h.callAnswer <- answer:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallIceCandidate(ice CallIceCandidate) {
	select {
	case h.callIceCandidate <- ice:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallJoin(join CallJoin) {
	select {
	case h.callJoin <- join:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallLeave(leave CallLeave) {
	select {
	case h.callLeave <- leave:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallEnd(end CallEnd) {
	select {
	case h.callEnd <- end:
	case <-time.After(time.Second):
	}
}

func (h *Hub) SendCallReject(reject CallReject) {
	select {
	case h.callReject <- reject:
	case <-time.After(time.Second):
	}
}

func (h *Hub) Register(client *Client) {
	h.register <- client
}

func (h *Hub) Unregister(client *Client) {
	h.unregister <- client
}
