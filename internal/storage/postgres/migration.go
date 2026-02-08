package postgres

import (
	"context"
	"fmt"
	"log"
)

var migrations = []string{
	`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`,
	
	`CREATE TABLE IF NOT EXISTS users (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		username VARCHAR(50) UNIQUE NOT NULL,
		password_hash VARCHAR(255) NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	);`,
	
	`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`,
	
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));`,
	
	`CREATE TABLE IF NOT EXISTS messages (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		payload BYTEA NOT NULL,
		created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
	);`,
	
	`CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);`,
	
	`CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);`,
	
	`CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);`,
}

func (s *Storage) Migrate(ctx context.Context) error {
	for i, migration := range migrations {
		_, err := s.pool.Exec(ctx, migration)
		if err != nil {
			return fmt.Errorf("migration %d failed: %w", i+1, err)
		}
	}
	
	log.Println("database migrations completed successfully")
	return nil
}
