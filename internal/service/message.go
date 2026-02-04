package service

import (
	"context"
	"fmt"
	"time"

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
	if s.userRepo == nil || s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}

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
		CreatedAt:  time.Now(),
	}

	if err := s.repo.Create(ctx, msg); err != nil {
		return nil, err
	}

	return msg, nil
}

func (s *MessageService) GetHistory(ctx context.Context, user1, user2 uuid.UUID, limit, offset int) ([]model.Message, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}

	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	return s.repo.GetByUserPair(ctx, user1, user2, limit, offset)
}

func (s *MessageService) GetConversationPartners(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}
	return s.repo.GetConversationPartners(ctx, userID)
}

type ChatWithUser struct {
	UserID          string    `json:"user_id"`
	Username        string    `json:"username"`
	LastMessage     string    `json:"last_message"`
	LastMessageTime time.Time `json:"last_message_time"`
}

func (s *MessageService) GetChatList(ctx context.Context, userID uuid.UUID) ([]ChatWithUser, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}

	chats, err := s.repo.GetChatList(ctx, userID)
	if err != nil {
		return nil, err
	}

	result := []ChatWithUser{}
	for _, chat := range chats {
		user, err := s.userRepo.GetByID(ctx, chat.PartnerID)
		if err != nil {
			continue
		}
		if user == nil {
			continue
		}

		// Decode payload to string
		lastMsgText := ""
		if chat.LastMessage != nil {
			lastMsgText = string(chat.LastMessage.Payload)
		}

		result = append(result, ChatWithUser{
			UserID:          user.ID.String(),
			Username:        user.Username,
			LastMessage:     lastMsgText,
			LastMessageTime: chat.LastMessage.CreatedAt,
		})
	}

	return result, nil
}
