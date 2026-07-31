-- ═══════════════════════════════════════════════════
-- Migration: SnapTrade connection columns
-- Purpose: Add SnapTrade-specific fields to broker_connections
-- Date: 2026-07-31
-- ═══════════════════════════════════════════════════

-- ── Add SnapTrade columns to broker_connections ────
-- Existing columns (api-key style brokers) remain unchanged.
-- New columns are nullable — only populated for SnapTrade connections.

ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS snaptrade_user_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snaptrade_user_secret_encrypted TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS brokerage_slug VARCHAR DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trading_enabled BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snaptrade_connection_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS snaptrade_accounts JSONB DEFAULT '[]'::jsonb;

-- ── Add unique constraint: one connection per user per brokerage slug ──
-- Prevents duplicate connections to the same broker for a user.
-- Only applies when brokerage_slug is not null (SnapTrade connections).

CREATE UNIQUE INDEX IF NOT EXISTS idx_broker_connections_user_broker
  ON public.broker_connections(user_id, brokerage_slug)
  WHERE brokerage_slug IS NOT NULL;

-- ── Comment on new columns ─────────────────────────

COMMENT ON COLUMN public.broker_connections.snaptrade_user_id
  IS 'SnapTrade user ID (vantage_<uuid>), immutable per Vantage user';

COMMENT ON COLUMN public.broker_connections.snaptrade_user_secret_encrypted
  IS 'SnapTrade user secret, AES-256-GCM encrypted with per-user key';

COMMENT ON COLUMN public.broker_connections.brokerage_slug
  IS 'SnapTrade brokerage slug (e.g. ALPACA-PAPER, ETRADE)';

COMMENT ON COLUMN public.broker_connections.trading_enabled
  IS 'Whether this connection supports trading — confirmed from API, not assumed';

COMMENT ON COLUMN public.broker_connections.snaptrade_connection_id
  IS 'SnapTrade brokerage authorization UUID (connection ID)';

COMMENT ON COLUMN public.broker_connections.snaptrade_accounts
  IS 'JSON array of connected SnapTrade accounts [{id, number, name, type, currency}]';
