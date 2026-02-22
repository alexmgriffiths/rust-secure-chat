CREATE TABLE pending_messages (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id   UUID NOT NULL,
    payload      TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    seq BIGINT GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX idx_pending_messages_inbox
    ON pending_messages (mailbox_id, created_at)
    WHERE delivered_at IS NULL;
CREATE INDEX idx_pending_messages_mailbox_seq ON pending_messages (mailbox_id, seq);