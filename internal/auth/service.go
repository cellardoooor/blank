package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type Service struct {
	userRepo    storage.UserRepository
	jwtSecret   []byte
	jwtDuration time.Duration
}

func NewService(userRepo storage.UserRepository, secret []byte, duration time.Duration) *Service {
	return &Service{
		userRepo:    userRepo,
		jwtSecret:   secret,
		jwtDuration: duration,
	}
}

type Claims struct {
	UserID uuid.UUID `json:"user_id"`
	jwt.RegisteredClaims
}

func (s *Service) HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

func (s *Service) CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func (s *Service) GenerateToken(userID uuid.UUID) (string, error) {
	claims := Claims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(s.jwtDuration)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

func (s *Service) ValidateToken(tokenString string) (uuid.UUID, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})
	if err != nil {
		return uuid.Nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		return claims.UserID, nil
	}
	return uuid.Nil, fmt.Errorf("invalid token claims")
}

func (s *Service) Register(ctx context.Context, username, password string) (*model.User, error) {
	if s.userRepo == nil {
		return nil, fmt.Errorf("database unavailable")
	}

	// Validate username length: 5-16 characters
	if len(username) < 5 || len(username) > 16 {
		return nil, fmt.Errorf("username must be between 5 and 16 characters")
	}

	// Validate password length: minimum 5 characters
	if len(password) < 5 {
		return nil, fmt.Errorf("password must be at least 5 characters")
	}

	existing, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, fmt.Errorf("username already taken")
	}

	hash, err := s.HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		ID:           uuid.New(),
		Username:     username,
		PasswordHash: hash,
		CreatedAt:    time.Now(),
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}

	return user, nil
}

func (s *Service) Login(ctx context.Context, username, password string) (string, error) {
	if s.userRepo == nil {
		return "", fmt.Errorf("database unavailable")
	}

	user, err := s.userRepo.GetByUsername(ctx, username)
	if err != nil {
		return "", err
	}
	if user == nil {
		return "", fmt.Errorf("invalid credentials")
	}

	if !s.CheckPassword(password, user.PasswordHash) {
		return "", fmt.Errorf("invalid credentials")
	}

	return s.GenerateToken(user.ID)
}
