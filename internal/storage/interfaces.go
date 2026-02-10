package storage

import (
	"context"

	"github.com/google/uuid"
	"messenger/internal/model"
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	GetByID(ctx context.Context, id uuid.UUID) (*model.User, error)
	GetByUsername(ctx context.Context, username string) (*model.User, error)
	GetAll(ctx context.Context) ([]model.User, error)
	UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error
}

type MessageRepository interface {
	Create(ctx context.Context, msg *model.Message) error
	GetByUserPair(ctx context.Context, user1, user2 uuid.UUID, limit, offset int) ([]model.Message, error)
	GetByUserPairWithReadStatus(ctx context.Context, currentUser, partnerID uuid.UUID, limit, offset int) ([]model.MessageWithRead, error)
	GetConversationPartners(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error)
	GetChatList(ctx context.Context, userID uuid.UUID) ([]ChatInfo, error)
	MarkAsRead(ctx context.Context, userID, partnerID uuid.UUID) error
	GetUnreadCounts(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]int, error)
}

type ChatInfo struct {
	PartnerID   uuid.UUID
	LastMessage *model.Message
	UnreadCount int
}

type TransactionManager interface {
	WithTx(ctx context.Context, fn func(context.Context) error) error
}
