-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table: core account information
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(24) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_username ON users(username);

-- Devices table: each user can have multiple devices (phone, desktop, etc)
-- Each device has its own cryptographic identity for E2EE
CREATE TABLE devices (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(64) NOT NULL,
    
    -- Long-term identity key (public part)
    identity_key_ed25519_public BYTEA NOT NULL,
    identity_key_x25519_public BYTEA NOT NULL,
    
    -- Current signed prekey for key exchange
    signed_prekey_id INTEGER NOT NULL,
    signed_prekey_public BYTEA NOT NULL,
    signed_prekey_signature BYTEA NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(user_id, device_name)
);

CREATE INDEX idx_devices_user_id ON devices(user_id);

-- One-time prekeys: consumed during initial key exchange for forward secrecy
CREATE TABLE one_time_prekeys (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    key_id INTEGER NOT NULL,
    public_key BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(device_id, key_id)
);

CREATE INDEX idx_one_time_prekeys_device_id ON one_time_prekeys(device_id);