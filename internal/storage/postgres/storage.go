package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

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

func (s *Storage) Call() storage.CallRepository {
	return &CallRepo{pool: s.pool}
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

func (r *UserRepo) GetByIDs(ctx context.Context, ids []uuid.UUID) ([]model.User, error) {
	if len(ids) == 0 {
		return []model.User{}, nil
	}
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users WHERE id = ANY($1)`
	rows, err := conn.Query(ctx, sql, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var user model.User
		if err := rows.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *UserRepo) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users WHERE LOWER(username) = LOWER($1)`
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

func (r *UserRepo) GetAll(ctx context.Context) ([]model.User, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users ORDER BY username`
	rows, err := conn.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var user model.User
		if err := rows.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *UserRepo) UpdatePassword(ctx context.Context, id uuid.UUID, passwordHash string) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE users SET password_hash = $1 WHERE id = $2`
	_, err := conn.Exec(ctx, sql, passwordHash, id)
	return err
}

func (r *UserRepo) SearchUsers(ctx context.Context, prefix string) ([]model.User, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, username, password_hash, created_at FROM users WHERE username ILIKE $1 ORDER BY username LIMIT 10`
	rows, err := conn.Query(ctx, sql, prefix+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.User
	for rows.Next() {
		var user model.User
		if err := rows.Scan(&user.ID, &user.Username, &user.PasswordHash, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
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

	messages := []model.Message{}
	for rows.Next() {
		var msg model.Message
		if err := rows.Scan(&msg.ID, &msg.SenderID, &msg.ReceiverID, &msg.Payload, &msg.CreatedAt); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func (r *MessageRepo) GetByUserPairWithReadStatus(ctx context.Context, currentUser, partnerID uuid.UUID, limit, offset int) ([]model.MessageWithRead, error) {
	conn := getConn(ctx, r.pool)
	sql := `
		SELECT m.id, m.sender_id, m.receiver_id, m.payload, m.created_at,
			CASE 
				WHEN m.sender_id = $2 THEN 
					COALESCE(cr.last_read_at >= m.created_at, false)
				ELSE 
					COALESCE(cr2.last_read_at >= m.created_at, false)
			END as is_read,
			CASE 
				WHEN m.sender_id = $2 THEN 
					COALESCE(md.delivered_at IS NOT NULL, false)
				ELSE 
					true
			END as is_delivered
		FROM messages m
		LEFT JOIN chat_reads cr ON cr.user_id = m.receiver_id AND cr.partner_id = m.sender_id
		LEFT JOIN chat_reads cr2 ON cr2.user_id = $2 AND cr2.partner_id = m.sender_id
		LEFT JOIN message_deliveries md ON md.message_id = m.id AND md.receiver_id = m.receiver_id
		WHERE (m.sender_id = $2 AND m.receiver_id = $1) OR (m.sender_id = $1 AND m.receiver_id = $2)
		ORDER BY m.created_at DESC LIMIT $3 OFFSET $4`
	rows, err := conn.Query(ctx, sql, partnerID, currentUser, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []model.MessageWithRead{}
	for rows.Next() {
		var msg model.MessageWithRead
		if err := rows.Scan(&msg.ID, &msg.SenderID, &msg.ReceiverID, &msg.Payload, &msg.CreatedAt, &msg.IsRead, &msg.IsDelivered); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, rows.Err()
}

func (r *MessageRepo) GetConversationPartners(ctx context.Context, userID uuid.UUID) ([]uuid.UUID, error) {
	conn := getConn(ctx, r.pool)
	sql := `
		SELECT DISTINCT CASE 
			WHEN sender_id = $1 THEN receiver_id 
			ELSE sender_id 
		END as partner_id 
		FROM messages 
		WHERE sender_id = $1 OR receiver_id = $1`
	rows, err := conn.Query(ctx, sql, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var partners []uuid.UUID
	for rows.Next() {
		var partnerID uuid.UUID
		if err := rows.Scan(&partnerID); err != nil {
			return nil, err
		}
		partners = append(partners, partnerID)
	}
	return partners, rows.Err()
}

func (r *MessageRepo) GetChatList(ctx context.Context, userID uuid.UUID) ([]storage.ChatInfo, error) {
	conn := getConn(ctx, r.pool)
	sql := `
		WITH last_messages AS (
			SELECT DISTINCT ON (
				CASE 
					WHEN sender_id = $1 THEN receiver_id 
					ELSE sender_id 
				END
			)
			id,
			sender_id,
			receiver_id,
			payload,
			created_at,
			CASE 
				WHEN sender_id = $1 THEN receiver_id 
				ELSE sender_id 
			END as partner_id
		FROM messages 
		WHERE sender_id = $1 OR receiver_id = $1
		ORDER BY partner_id, created_at DESC
		)
		SELECT partner_id, id, sender_id, receiver_id, payload, created_at 
		FROM last_messages 
		ORDER BY created_at DESC`

	rows, err := conn.Query(ctx, sql, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	chats := []storage.ChatInfo{}
	for rows.Next() {
		var chat storage.ChatInfo
		var msg model.Message
		err := rows.Scan(&chat.PartnerID, &msg.ID, &msg.SenderID, &msg.ReceiverID, &msg.Payload, &msg.CreatedAt)
		if err != nil {
			return nil, err
		}
		chat.LastMessage = &msg
		chats = append(chats, chat)
	}
	return chats, rows.Err()
}

func (r *MessageRepo) MarkAsRead(ctx context.Context, userID, partnerID uuid.UUID) error {
	conn := getConn(ctx, r.pool)
	sql := `
		INSERT INTO chat_reads (user_id, partner_id, last_read_at) 
		VALUES ($1, $2, NOW()) 
		ON CONFLICT (user_id, partner_id) 
		DO UPDATE SET last_read_at = NOW()`
	_, err := conn.Exec(ctx, sql, userID, partnerID)
	return err
}

func (r *MessageRepo) MarkAsDelivered(ctx context.Context, messageID, receiverID uuid.UUID) error {
	conn := getConn(ctx, r.pool)
	sql := `
		INSERT INTO message_deliveries (message_id, receiver_id, delivered_at) 
		VALUES ($1, $2, NOW()) 
		ON CONFLICT (message_id, receiver_id) 
		DO NOTHING`
	_, err := conn.Exec(ctx, sql, messageID, receiverID)
	return err
}

func (r *MessageRepo) GetUnreadCounts(ctx context.Context, userID uuid.UUID) (map[uuid.UUID]int, error) {
	conn := getConn(ctx, r.pool)
	sql := `
		SELECT m.sender_id, COUNT(*) 
		FROM messages m
		LEFT JOIN chat_reads cr ON cr.user_id = $1 AND cr.partner_id = m.sender_id
		WHERE m.receiver_id = $1 
		  AND m.sender_id != $1
		  AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)
		GROUP BY m.sender_id`

	rows, err := conn.Query(ctx, sql, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[uuid.UUID]int)
	for rows.Next() {
		var senderID uuid.UUID
		var count int
		if err := rows.Scan(&senderID, &count); err != nil {
			return nil, err
		}
		counts[senderID] = count
	}
	return counts, rows.Err()
}

type CallRepo struct {
	pool *pgxpool.Pool
}

func (r *CallRepo) Create(ctx context.Context, call *model.Call) error {
	conn := getConn(ctx, r.pool)
	sql := `INSERT INTO calls (id, initiator_id, call_type, status, created_at) VALUES ($1, $2, $3, $4, $5)`
	_, err := conn.Exec(ctx, sql, call.ID, call.InitiatorID, call.CallType, call.Status, call.CreatedAt)
	return err
}

func (r *CallRepo) GetByID(ctx context.Context, id uuid.UUID) (*model.Call, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, initiator_id, call_type, status, started_at, ended_at, created_at FROM calls WHERE id = $1`
	call := &model.Call{}
	err := conn.QueryRow(ctx, sql, id).Scan(&call.ID, &call.InitiatorID, &call.CallType, &call.Status, &call.StartedAt, &call.EndedAt, &call.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return call, nil
}

func (r *CallRepo) GetByStatus(ctx context.Context, status string) ([]model.Call, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, initiator_id, call_type, status, started_at, ended_at, created_at FROM calls WHERE status = $1 ORDER BY created_at DESC`
	rows, err := conn.Query(ctx, sql, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	calls := []model.Call{}
	for rows.Next() {
		var call model.Call
		if err := rows.Scan(&call.ID, &call.InitiatorID, &call.CallType, &call.Status, &call.StartedAt, &call.EndedAt, &call.CreatedAt); err != nil {
			return nil, err
		}
		calls = append(calls, call)
	}
	return calls, rows.Err()
}

func (r *CallRepo) UpdateStatus(ctx context.Context, id uuid.UUID, status string) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE calls SET status = $1 WHERE id = $2`
	_, err := conn.Exec(ctx, sql, status, id)
	return err
}

func (r *CallRepo) UpdateStartedAt(ctx context.Context, id uuid.UUID, startedAt *time.Time) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE calls SET started_at = $1 WHERE id = $2`
	_, err := conn.Exec(ctx, sql, startedAt, id)
	return err
}

func (r *CallRepo) UpdateEndedAt(ctx context.Context, id uuid.UUID, endedAt *time.Time) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE calls SET ended_at = $1 WHERE id = $2`
	_, err := conn.Exec(ctx, sql, endedAt, id)
	return err
}

func (r *CallRepo) Delete(ctx context.Context, id uuid.UUID) error {
	conn := getConn(ctx, r.pool)
	sql := `DELETE FROM calls WHERE id = $1`
	_, err := conn.Exec(ctx, sql, id)
	return err
}

func (r *CallRepo) CreateParticipant(ctx context.Context, participant *model.CallParticipant) error {
	conn := getConn(ctx, r.pool)
	sql := `INSERT INTO call_participants (id, call_id, user_id, status, joined_at, left_at, audio_enabled, video_enabled, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
	_, err := conn.Exec(ctx, sql, participant.ID, participant.CallID, participant.UserID, participant.Status, participant.JoinedAt, participant.LeftAt, participant.AudioEnabled, participant.VideoEnabled, participant.CreatedAt)
	return err
}

func (r *CallRepo) GetParticipantsByCallID(ctx context.Context, callID uuid.UUID) ([]model.CallParticipant, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, call_id, user_id, status, joined_at, left_at, audio_enabled, video_enabled, created_at FROM call_participants WHERE call_id = $1 ORDER BY created_at`
	rows, err := conn.Query(ctx, sql, callID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	participants := []model.CallParticipant{}
	for rows.Next() {
		var participant model.CallParticipant
		if err := rows.Scan(&participant.ID, &participant.CallID, &participant.UserID, &participant.Status, &participant.JoinedAt, &participant.LeftAt, &participant.AudioEnabled, &participant.VideoEnabled, &participant.CreatedAt); err != nil {
			return nil, err
		}
		participants = append(participants, participant)
	}
	return participants, rows.Err()
}

func (r *CallRepo) GetParticipant(ctx context.Context, callID, userID uuid.UUID) (*model.CallParticipant, error) {
	conn := getConn(ctx, r.pool)
	sql := `SELECT id, call_id, user_id, status, joined_at, left_at, audio_enabled, video_enabled, created_at FROM call_participants WHERE call_id = $1 AND user_id = $2`
	participant := &model.CallParticipant{}
	err := conn.QueryRow(ctx, sql, callID, userID).Scan(&participant.ID, &participant.CallID, &participant.UserID, &participant.Status, &participant.JoinedAt, &participant.LeftAt, &participant.AudioEnabled, &participant.VideoEnabled, &participant.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return participant, nil
}

func (r *CallRepo) UpdateParticipantStatus(ctx context.Context, callID, userID uuid.UUID, status string) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE call_participants SET status = $1 WHERE call_id = $2 AND user_id = $3`
	_, err := conn.Exec(ctx, sql, status, callID, userID)
	return err
}

func (r *CallRepo) UpdateParticipantJoinedAt(ctx context.Context, callID, userID uuid.UUID, joinedAt *time.Time) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE call_participants SET joined_at = $1 WHERE call_id = $2 AND user_id = $3`
	_, err := conn.Exec(ctx, sql, joinedAt, callID, userID)
	return err
}

func (r *CallRepo) UpdateParticipantLeftAt(ctx context.Context, callID, userID uuid.UUID, leftAt *time.Time) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE call_participants SET left_at = $1 WHERE call_id = $2 AND user_id = $3`
	_, err := conn.Exec(ctx, sql, leftAt, callID, userID)
	return err
}

func (r *CallRepo) UpdateParticipantMediaSettings(ctx context.Context, callID, userID uuid.UUID, audioEnabled, videoEnabled bool) error {
	conn := getConn(ctx, r.pool)
	sql := `UPDATE call_participants SET audio_enabled = $1, video_enabled = $2 WHERE call_id = $3 AND user_id = $4`
	_, err := conn.Exec(ctx, sql, audioEnabled, videoEnabled, callID, userID)
	return err
}

func (r *CallRepo) DeleteParticipant(ctx context.Context, callID, userID uuid.UUID) error {
	conn := getConn(ctx, r.pool)
	sql := `DELETE FROM call_participants WHERE call_id = $1 AND user_id = $2`
	_, err := conn.Exec(ctx, sql, callID, userID)
	return err
}

func (r *CallRepo) GetCallHistory(ctx context.Context, userID uuid.UUID, limit, offset int) ([]model.CallHistoryItem, error) {
	conn := getConn(ctx, r.pool)
	sql := `
		SELECT c.id, c.initiator_id, c.call_type, c.status, c.started_at, c.ended_at, c.created_at,
			u.id, u.username, u.created_at
		FROM calls c
		LEFT JOIN call_participants cp ON cp.call_id = c.id
		LEFT JOIN users u ON u.id = c.initiator_id
		WHERE cp.user_id = $1
		ORDER BY c.created_at DESC
		LIMIT $2 OFFSET $3`
	rows, err := conn.Query(ctx, sql, userID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	history := []model.CallHistoryItem{}
	for rows.Next() {
		var item model.CallHistoryItem
		var user model.User
		err := rows.Scan(&item.CallID, &item.InitiatorID, &item.CallType, &item.Status, &item.StartedAt, &item.EndedAt, &item.CallCreatedAt, &user.ID, &user.Username, &user.CreatedAt)
		if err != nil {
			return nil, err
		}
		item.Initiator = &user
		history = append(history, item)
	}
	return history, rows.Err()
}
