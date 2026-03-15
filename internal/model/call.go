package model

import (
	"time"

	"github.com/google/uuid"
)

type CallType string

const (
	CallTypeAudio CallType = "audio"
	CallTypeVideo CallType = "video"
)

type CallStatus string

const (
	CallStatusRinging CallStatus = "ringing"
	CallStatusActive  CallStatus = "active"
	CallStatusEnded   CallStatus = "ended"
)

type Call struct {
	ID          uuid.UUID  `json:"id"`
	InitiatorID uuid.UUID  `json:"initiator_id"`
	CallType    CallType   `json:"call_type"`
	Status      CallStatus `json:"status"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

type CallParticipantStatus string

const (
	CallParticipantStatusInvited  CallParticipantStatus = "invited"
	CallParticipantStatusActive   CallParticipantStatus = "active"
	CallParticipantStatusLeft     CallParticipantStatus = "left"
	CallParticipantStatusRejected CallParticipantStatus = "rejected"
)

type CallParticipant struct {
	ID           uuid.UUID           `json:"id"`
	CallID       uuid.UUID           `json:"call_id"`
	UserID       uuid.UUID           `json:"user_id"`
	Status       CallParticipantStatus `json:"status"`
	JoinedAt     *time.Time          `json:"joined_at,omitempty"`
	LeftAt       *time.Time          `json:"left_at,omitempty"`
	AudioEnabled bool                `json:"audio_enabled"`
	VideoEnabled bool                `json:"video_enabled"`
	CreatedAt    time.Time           `json:"created_at"`
}

type CallInfo struct {
	Call         Call              `json:"call"`
	Participants []CallParticipant `json:"participants"`
}

type CallHistoryItem struct {
	CallID      uuid.UUID  `json:"call_id"`
	CallType    CallType   `json:"call_type"`
	Status      CallStatus `json:"status"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	EndedAt     *time.Time `json:"ended_at,omitempty"`
	CallCreatedAt time.Time `json:"call_created_at"`
	InitiatorID uuid.UUID  `json:"initiator_id"`
	Initiator   *User      `json:"initiator,omitempty"`
}
