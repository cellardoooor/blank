CREATE TABLE IF NOT EXISTS chat_reads (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_user ON chat_reads(user_id);
