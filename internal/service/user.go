package service

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type UserService struct {
	repo storage.UserRepository
}

func NewUserService(repo storage.UserRepository) *UserService {
	return &UserService{repo: repo}
}

func (s *UserService) GetByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}
	return s.repo.GetByID(ctx, id)
}

func (s *UserService) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	if s.repo == nil {
		return nil, fmt.Errorf("database unavailable")
	}
	return s.repo.GetByUsername(ctx, username)
}
