-- Add case-insensitive unique constraint on username
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username));
