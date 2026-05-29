-- Migration: Broker Vault Upgrade
-- Adds columns for broker-agnostic credential storage.
-- Existing columns (encrypted_api_key, encrypted_secret_key, master_password_hash)
-- are preserved for backward compatibility during transition.

ALTER TABLE vault ADD COLUMN IF NOT EXISTS broker_id TEXT;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS encrypted_credentials TEXT;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS credential_hash TEXT;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS is_connected BOOLEAN DEFAULT false;
ALTER TABLE vault ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;
