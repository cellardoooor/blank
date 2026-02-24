CREATE TABLE IF NOT EXISTS message_deliveries (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (message_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_receiver ON message_deliveries(receiver_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_delivered BOOLEAN DEFAULT false;
