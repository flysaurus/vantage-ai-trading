-- ═══════════════════════════════════════════════════════════════
-- Migration: positions.connection_id — cross-account scoping
-- Run in: Supabase SQL Editor
-- Purpose: Tag live positions with the exact broker_connections row
--          they came from, so a user with multiple connected brokers
--          can never have broker B's data silently substituted for
--          broker A's (and vice versa). Previously positions carried
--          only is_demo, so live rows from different connections were
--          indistinguishable and any "delete + reinsert" sync could
--          wipe one broker's rows while writing another's.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.positions.connection_id IS
  'broker_connections.id of the connection that produced this live position row. NULL for demo rows (is_demo = true).';

-- Composite index: the hot query is "all live positions for a user,
-- optionally scoped to one connection".
CREATE INDEX IF NOT EXISTS idx_positions_user_connection
  ON public.positions(user_id, connection_id)
  WHERE is_demo = false;

COMMIT;
