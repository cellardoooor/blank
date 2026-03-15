package storage

import (
	"context"
	"time"

	"github.com/google/uuid"
	"messenger/internal/model"
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	GetByID(ctx context.Context, id uuid.UUID) (*model.User, error)
	GetByIDs(ctx context.Context, ids []uuid.UUID) ([]model.User, error)
	GetByUsername(ctx context.Context, username string) (*model.User, error)
	GetAll(ctx context.Context) ([]model.User, error)
	SearchUsers(ctx context.Context, prefix string) ([]model.User, error)
	UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error
}

type MessageRepository interface {
	Create(ctx context.Context, msg *model.Message) error
	GetByUserPair(ctx context.Context, user1, user2 uuid.UUID, limit, offset int) ([]model.Message, error)
	GetByUserPairWithReadStatus(ctx context.Context, currentUser, partnerID uuid.UUID, limit, offset int) ([]model.MessageWithRead, error)
	GetConversationPartners(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	GetChatList(ctx context.Context, userID uuid.UUID) ([]ChatInfo, error)
	MarkAsRead(ctx context.Context, userID, partnerID uuid.UUID) error
	MarkAsDelivered(ctx context.Context, messageID, receiverID uuid.UUID) error
	GetUnreadCounts(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]int, error)
}

type ChatInfo struct {
	PartnerID   uuid.UUID
	LastMessage *model.Message
	UnreadCount int
}

type CallRepository interface {
	Create(ctx context.Context, call *model.Call) error
	GetByID(ctx context.Context, id uuid.UUID) (*model.Call, error)
	GetByStatus(ctx context.Context, status string) ([]model.Call, error)
	UpdateStatus(ctx context.Context, id uuid.UUID, status string) error
	UpdateStartedAt(ctx context.Context, id uuid.UUID, startedAt *time.Time) error
	UpdateEndedAt(ctx context.Context, id uuid.UUID, endedAt *time.Time) error
	Delete(ctx context.Context, id uuid.UUID) error

	CreateParticipant(ctx context.Context, participant *model.CallParticipant) error
	GetParticipantsByCallID(ctx context.Context, callID uuid.UUID) ([]model.CallParticipant, error)
	GetParticipant(ctx context.Context, callID, userID uuid.UUID) (*model.CallParticipant, error)
	UpdateParticipantStatus(ctx context.Context, callID, userID uuid.UUID, status string) error
	UpdateParticipantJoinedAt(ctx context.Context, callID, userID uuid.UUID, joinedAt *time.Time) error
	UpdateParticipantLeftAt(ctx context.Context, callID, userID uuid.UUID, leftAt *time.Time) error
	UpdateParticipantMediaSettings(ctx context.Context, callID, userID uuid.UUID, audioEnabled, videoEnabled bool) error
	DeleteParticipant(ctx context.Context, callID, userID uuid.UUID) error

	GetCallHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]model.CallHistoryItem, error)
}

type TransactionManager interface {
	WithTx(ctx context.Context, fn func(context.Context) error) error
}
