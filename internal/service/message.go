package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type MessageService struct {
	repo     storage.MessageRepository
	userRepo storage.UserRepository
}

func NewMessageService(repo storage.MessageRepository, userRepo storage.UserRepository) *MessageService {
	return &MessageService{
		repo:     repo,
		userRepo: userRepo,
	}
}

func (s *MessageService) Send(ctx context.Context, senderID, receiverID uuid.UUID, payload []byte) (*model.Message, error) {
	receiver, err := s.userRepo.GetByID(ctx, receiverID)
	if err != nil {
		return nil, err
	}
	if receiver == nil {
		return nil, fmt.Errorf("receiver not found")
	}

	msg := &model.Message{
		ID:         uuid.New(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		Payload:    payload,
	}

	if err := s.repo.Create(ctx, msg); err != nil {
		return nil, err
	}

	return msg, nil
}

func (s *MessageService) GetHistory(ctx context.Context, user1, user2 uuid.UUID, limit, offset int) ([]model.Message, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetByUserPair(ctx, user1, user2, limit, offset)
}
