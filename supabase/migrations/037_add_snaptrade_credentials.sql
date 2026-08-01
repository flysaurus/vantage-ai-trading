-- ══════════════════════════════════════════════════════════════
-- Migration: 037_add_snaptrade_credentials.sql
-- Purpose: Store SnapTrade userId + userSecret (encrypted) in
--          broker_connections so the adapter can call SnapTrade
--          API independently after initial OAuth.
-- ══════════════════════════════════════════════════════════════

-- Add SnapTrade-specific credential columns
ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS snaptrade_user_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snaptrade_user_secret TEXT DEFAULT NULL;

-- Index for SnapTrade user ID lookups
CREATE INDEX IF NOT EXISTS idx_broker_connections_snaptrade_user
  ON public.broker_connections(snaptrade_user_id);

COMMENT ON COLUMN public.broker_connections.snaptrade_user_id IS 'SnapTrade-registered user ID (returned by /snap_trade/registerUser)';
COMMENT ON COLUMN public.broker_connections.snaptrade_user_secret IS 'Encrypted SnapTrade user secret for subsequent API calls';
