package ws

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"messenger/internal/model"
	"messenger/internal/service"
)

// CallSignaling handles call signaling through WebSocket
type CallSignaling struct {
	hub            *Hub
	callService    *service.CallService
	userService    *service.UserService
	messageService *service.MessageService
	contextTimeout time.Duration
}

// NewCallSignaling creates a new CallSignaling instance
func NewCallSignaling(hub *Hub, callSvc *service.CallService, userSvc *service.UserService, msgSvc *service.MessageService, timeout time.Duration) *CallSignaling {
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	return &CallSignaling{
		hub:            hub,
		callService:    callSvc,
		userService:    userSvc,
		messageService: msgSvc,
		contextTimeout: timeout,
	}
}

// HandleCallStart handles call_start message
func (cs *CallSignaling) HandleCallStart(client *Client, data []byte) {
	var msg CallStart
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_start: %v", err)
		return
	}

	// Validate participants
	participantIDs := make([]uuid.UUID, 0, len(msg.Participants))
	for _, pid := range msg.Participants {
		if pid != client.userID {
			participantIDs = append(participantIDs, pid)
		}
	}

	if len(participantIDs) == 0 {
		log.Printf("no valid participants for call")
		return
	}

	// Create call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	callType := model.CallType(msg.CallType)
	if callType != model.CallTypeAudio && callType != model.CallTypeVideo {
		callType = model.CallTypeAudio
	}

	call, err := cs.callService.CreateCall(ctx, client.userID, callType, participantIDs)
	if err != nil {
		log.Printf("failed to create call: %v", err)
		return
	}

	// Update msg with actual call ID
	msg.CallID = call.ID
	msg.CallerID = client.userID

	// Send call_start back to caller with the real call ID
	callerStart := CallStart{
		Type:         "call_start",
		CallID:       call.ID,
		CallType:     string(callType),
		Participants: []uuid.UUID{client.userID},
		CallerID:     client.userID,
	}
	select {
	case client.sendCallStart <- callerStart:
	default:
	}

	// Filter out caller from participants before broadcasting to avoid duplicate
	filteredParticipants := make([]uuid.UUID, 0, len(participantIDs))
	for _, pid := range participantIDs {
		if pid != client.userID {
			filteredParticipants = append(filteredParticipants, pid)
		}
	}
	msg.Participants = filteredParticipants

	// Send call_start to all other participants (excluding caller)
	if len(filteredParticipants) > 0 {
		cs.hub.SendCallStart(msg)
	}
}

// HandleCallOffer handles call_offer message
func (cs *CallSignaling) HandleCallOffer(client *Client, data []byte) {
	var msg CallOffer
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_offer: %v", err)
		return
	}

	// If target_user_id is specified, send directly to that participant
	// Otherwise, broadcast to all participants (for backward compatibility)
	if msg.TargetUserID != uuid.Nil {
		// Get the target client
		cs.hub.mu.RLock()
		targetClient, ok := cs.hub.clients[msg.TargetUserID]
		cs.hub.mu.RUnlock()
		
		if ok {
			// Send offer directly to the target
			sent := cs.hub.sendToClientChan(targetClient, msg)
			if sent {
				log.Printf("Sent call_offer directly to user %s for call %s", msg.TargetUserID, msg.CallID)
			} else {
				log.Printf("WARNING: call_offer channel full, message dropped for user %s in call %s", msg.TargetUserID, msg.CallID)
			}
		} else {
			log.Printf("Target user %s not found for call_offer in call %s", msg.TargetUserID, msg.CallID)
		}
		return
	}

	// Get participants for this call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	participants, err := cs.callService.GetCallParticipants(ctx, msg.CallID)
	if err != nil {
		log.Printf("failed to get call participants: %v", err)
		return
	}

	// Collect participant IDs (excluding sender) for efficient batch sending
	participantIDs := make([]uuid.UUID, 0, len(participants))
	for _, p := range participants {
		if p.UserID != client.userID {
			participantIDs = append(participantIDs, p.UserID)
		}
	}

	// Create a single offer message and broadcast to all participants except sender
	offer := CallOffer{
		Type:         "call_offer",
		CallID:       msg.CallID,
		CallerID:     msg.CallerID,
		SDP:          msg.SDP,
		CallType:     msg.CallType,
		Participants: participantIDs,
	}
	
	// Use the exported helper function that explicitly excludes the sender
	cs.hub.SendToParticipantsExcluding(participantIDs, client.userID, func(c *Client) interface{} { return offer })
}

// HandleCallAnswer handles call_answer message
func (cs *CallSignaling) HandleCallAnswer(client *Client, data []byte) {
	var msg CallAnswer
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_answer: %v", err)
		return
	}

	// Get call to find the initiator (caller) with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	callInfo, err := cs.callService.GetCall(ctx, msg.CallID)
	if err != nil {
		log.Printf("failed to get call: %v", err)
		return
	}

	// The caller is the call initiator
	callerID := callInfo.Call.InitiatorID

	if callerID == uuid.Nil {
		log.Printf("caller not found for call %s", msg.CallID)
		return
	}

	// Send answer to caller
	answer := CallAnswer{
		Type:     "call_answer",
		CallID:   msg.CallID,
		CalleeID: client.userID,
		SDP:      msg.SDP,
	}
	cs.hub.SendCallAnswer(answer)
}

// HandleCallIceCandidate handles call_ice_candidate message
func (cs *CallSignaling) HandleCallIceCandidate(client *Client, data []byte) {
	var msg CallIceCandidate
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_ice_candidate: %v", err)
		return
	}

	// Validate that target user ID is provided
	if msg.TargetUserID == uuid.Nil {
		log.Printf("target_user_id is required for ICE candidate")
		return
	}

	// Verify sender is a participant in the call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	participants, err := cs.callService.GetCallParticipants(ctx, msg.CallID)
	if err != nil {
		log.Printf("failed to get call participants for ICE candidate: %v", err)
		return
	}

	// Check if sender is a participant
	isParticipant := false
	for _, p := range participants {
		if p.UserID == client.userID {
			isParticipant = true
			break
		}
	}
	if !isParticipant {
		log.Printf("user %s not authorized to send ICE candidate for call %s", client.userID, msg.CallID)
		return
	}

	// Send ICE candidate to the target user (the peer)
	ice := CallIceCandidate{
		Type:        "call_ice_candidate",
		CallID:      msg.CallID,
		UserID:      client.userID,
		TargetUserID: msg.TargetUserID,
		Candidate:   msg.Candidate,
	}
	cs.hub.SendCallIceCandidate(ice)
}

// HandleCallJoin handles call_join message
func (cs *CallSignaling) HandleCallJoin(client *Client, data []byte) {
	var msg CallJoin
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_join: %v", err)
		return
	}

	// Join the call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	if err := cs.callService.JoinCall(ctx, msg.CallID, client.userID); err != nil {
		log.Printf("failed to join call: %v", err)
		return
	}

	// Update msg with actual user ID
	msg.UserID = client.userID

	// Send call_join to all participants
	cs.hub.SendCallJoin(msg)
}

// HandleCallLeave handles call_leave message
func (cs *CallSignaling) HandleCallLeave(client *Client, data []byte) {
	var msg CallLeave
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_leave: %v", err)
		return
	}

	// Leave the call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	if err := cs.callService.LeaveCall(ctx, msg.CallID, client.userID); err != nil {
		log.Printf("failed to leave call: %v", err)
		return
	}

	// Update msg with actual user ID
	msg.UserID = client.userID

	// Send call_leave to all participants
	cs.hub.SendCallLeave(msg)
}

// HandleCallEnd handles call_end message
func (cs *CallSignaling) HandleCallEnd(client *Client, data []byte) {
	var msg CallEnd
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_end: %v", err)
		return
	}

	// End the call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	if err := cs.callService.EndCall(ctx, msg.CallID, client.userID); err != nil {
		log.Printf("failed to end call: %v", err)
		return
	}

	// Update msg with actual user ID
	msg.UserID = client.userID

	// Send call_end to all participants
	cs.hub.SendCallEnd(msg)
}

// HandleCallReject handles call_reject message
func (cs *CallSignaling) HandleCallReject(client *Client, data []byte) {
	var msg CallReject
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("failed to unmarshal call_reject: %v", err)
		return
	}

	// Reject the call with timeout
	ctx, cancel := context.WithTimeout(context.Background(), cs.contextTimeout)
	defer cancel()

	if err := cs.callService.RejectCall(ctx, msg.CallID, client.userID); err != nil {
		log.Printf("failed to reject call: %v", err)
		return
	}

	// Get call to find the initiator (caller)
	callInfo, err := cs.callService.GetCall(ctx, msg.CallID)
	if err != nil {
		log.Printf("failed to get call for reject: %v", err)
		return
	}

	// GetCall returns error if call not found, so callInfo is guaranteed non-nil here
	// Send call_reject to the caller (initiator), not the rejector
	if callInfo.Call.InitiatorID != uuid.Nil && callInfo.Call.InitiatorID != client.userID {
		reject := CallReject{
			Type:     "call_reject",
			CallID:   msg.CallID,
			UserID:   client.userID,
		}
		cs.hub.SendToClient(callInfo.Call.InitiatorID, func(c *Client) interface{} { return reject })
	}
}
