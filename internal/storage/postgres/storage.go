package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"messenger/internal/model"
	"messenger/internal/storage"
)

type Storage struct {
	pool *pgxpool.Pool
}

func New(dsn string) (*Storage, error) {
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to create pool: %w", err)
	}
	return &Storage{pool: pool}, nil
}

func (s *Storage) Close() {
	s.pool.Close()
}

func (s *Storage) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Storage) User() storage.UserRepository {
	return &UserRepo{pool: s.pool}
}

func (s *Storage) Message() storage.MessageRepository {
	return &MessageRepo{pool: s.pool}
}

func (s *Storage) WithTx(ctx context.Context, fn func(context.Context) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	txCtx := context.WithValue(ctx, txKey{}, tx)
	if err := fn(txCtx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

type txKey struct{}

func getConn(ctx context.Context, pool *pgxpool.Pool) pgxConn {
	if tx, ok := ctx.Value(txKey{}).(pgx.Tx); ok {
		return tx
	}
	return pool
}

type pgxConn interface {
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
	Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error)
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

type UserRepo struct {
	pool *pgxpool.Pool
}

func (r *UserRepo) Create(ctx context.Context, user *model.User) error {
	conn := getConn(ctx, r.pool)
	sql := `INSERT INTO users (id, username, password_hash, created_at) VALUES ($1, $2, $3, $4)`
	_, err := conn.Exec(ctx, sql, user.ID, user.Username, user.PasswordHash, user.CreatedAt)
	return err
}

func (r *UserRepo) GetByID(ctx context.Context, id uuid.UUID) (*model.User, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users WHERE id = $1`
	user := &model.User{}
	err := conn.QueryRow(ctx, sql, id).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users WHERE username = $1`
	user := &model.User{}
	err := conn.QueryRow(ctx, sql, username).Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return user, nil
}

type MessageRepo struct {
	pool *pgxpool.Pool
}

func (r *MessageRepo) Create(ctx context.Context, msg *model.Message) error {
	conn := getConn(ctx, r.pool)
	sql := `INSERT INTO messages (id, sender_id, receiver_id, payload, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := conn.Exec(ctx, sql, msg.ID, msg.SenderID, msg.ReceiverID, msg.Payload, msg.CreatedAt)
	return err
}

func (r *MessageRepo) GetByUserPair(ctx context.Context, user1, user2 uuid.UUID, limit, offset int) ([]model.Message, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, sender_id, receiver_id, payload, created_at FROM messages 
		WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1) 
		ORDER BY created_at DESC LIMIT $3 OFFSET $4`
	rows, err := conn.Query(ctx, sql, user1, user2, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []model.Message
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(&msg.ID, &msg.SenderID, &msg.ReceiverID, &msg.Payload, &msg.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}
