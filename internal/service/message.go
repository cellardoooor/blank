package service

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"messenger/internal/crypto"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type MessageService struct {
	repo      storage.MessageRepository
	userRepo  storage.UserRepository
	encryptor *crypto.Encryptor
}

func NewMessageService(repo storage.MessageRepository, userRepo storage.UserRepository, encryptor *crypto.Encryptor) *MessageService {
	return &MessageService{
		repo:      repo,
		userRepo:  userRepo,
		encryptor: encryptor,
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

	// Encrypt payload before saving
	encryptedPayload, err := s.encryptor.Encrypt(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt message: %w", err)
	}

	msg := &model.Message{
		ID:         uuid.New(),
		SenderID:   senderID,
		ReceiverID: receiverID,
		Payload:    []byte(encryptedPayload),
		CreatedAt:  time.Now(),
	}

	if err := s.repo.Create(ctx, msg); err != nil {
		return nil, err
	}

	// Return decrypted payload for the response
	msg.Payload = payload
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

	messages, err := s.repo.GetByUserPair(ctx, user1, user2, limit, offset)
	if err != nil {
		return nil, err
	}

	// Decrypt messages
	for i := range messages {
		decrypted, err := s.encryptor.Decrypt(string(messages[i].Payload))
		if err != nil {
			// If decryption fails, keep the original (for backward compatibility)
			continue
		}
		messages[i].Payload = decrypted
	}

	return messages, nil
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
	UnreadCount     int       `json:"unread_count"`
}

func (s *MessageService) GetChatList(ctx context.Context, userID uuid.UUID) ([]ChatWithUser, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}

	chats, err := s.repo.GetChatList(ctx, userID)
	if err != nil {
		return nil, err
	}

	unreadCounts, err := s.repo.GetUnreadCounts(ctx, userID)
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

		// Decrypt and decode payload to string
		lastMsgText := ""
		if chat.LastMessage != nil {
			decrypted, err := s.encryptor.Decrypt(string(chat.LastMessage.Payload))
			if err == nil {
				lastMsgText = string(decrypted)
			} else {
				// Fallback for backward compatibility
				lastMsgText = string(chat.LastMessage.Payload)
			}
		}

		unreadCount := unreadCounts[chat.PartnerID]

		result = append(result, ChatWithUser{
			UserID:          user.ID.String(),
			Username:        user.Username,
			LastMessage:     lastMsgText,
			LastMessageTime: chat.LastMessage.CreatedAt,
			UnreadCount:     unreadCount,
		})
	}

	return result, nil
}

func (s *MessageService) MarkChatAsRead(ctx context.Context, userID, partnerID uuid.UUID) error {
	if s.repo == nil {
		return fmt.Errorf("database unavailable")
	}
	return s.repo.MarkAsRead(ctx, userID, partnerID)
}
