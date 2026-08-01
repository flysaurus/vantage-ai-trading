-- ═══════════════════════════════════════════════════
-- Migration: SnapTrade read-only broker support
-- Purpose: Add trading_enabled + snaptrade_broker_id
--          to broker_connections for read-only gate
-- Date: 2026-08-01
-- ═══════════════════════════════════════════════════

BEGIN;

-- ── STEP 1: Add trading_enabled column ──────────────────
ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS trading_enabled BOOLEAN DEFAULT true;

-- ── STEP 2: Add snaptrade_broker_id column ──────────────
-- Used to track which specific broker (Fidelity, Schwab, etc.)
-- was connected through SnapTrade.
ALTER TABLE public.broker_connections
  ADD COLUMN IF NOT EXISTS snaptrade_broker_id TEXT DEFAULT NULL;

-- ── STEP 3: Drop + recreate CHECK constraint ────────────
-- Re-add the connection_type check to ensure it still works
DO $$ BEGIN
  ALTER TABLE public.broker_connections
    DROP CONSTRAINT IF EXISTS broker_connections_connection_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.broker_connections
  ADD CONSTRAINT broker_connections_connection_type_check
  CHECK (connection_type IN ('snaptrade','alpaca','tastytrade'));

-- ── STEP 4: Index on snaptrade_broker_id ────────────────
CREATE INDEX IF NOT EXISTS idx_broker_connections_snaptrade_broker
  ON public.broker_connections(user_id, snaptrade_broker_id);

COMMIT;
