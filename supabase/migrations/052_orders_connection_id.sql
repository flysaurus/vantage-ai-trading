-- ═══════════════════════════════════════════════════════════════
-- Migration: orders.connection_id — cross-account order scoping
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: Tag live orders with the exact broker_connections row so
--          order/trade history is isolated per account (mirrors the
--          positions.connection_id fix in migration 048).
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add the column (nullable; demo orders stay NULL, live orders get a conn id)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES public.broker_connections(id) ON DELETE SET NULL;

-- 2. Backfill existing LIVE orders with the user's connected broker.
--    Users with exactly one connected broker are unambiguous; for a user
--    with 2+ brokers this attaches the oldest connection as a best-effort
--    default (they were necessarily placed through one of them, and the
--    column is a best-effort backfill, not authoritative for old rows).
UPDATE public.orders o
SET connection_id = (
  SELECT bc.id
  FROM public.broker_connections bc
  WHERE bc.user_id = o.user_id
    AND bc.connection_type = 'snaptrade'
    AND bc.status = 'connected'
  ORDER BY bc.created_at ASC
  LIMIT 1
)
WHERE o.is_demo = false
  AND o.connection_id IS NULL;

-- 3. Composite index for the hot per-account order lookups
CREATE INDEX IF NOT EXISTS idx_orders_user_connection
  ON public.orders(user_id, connection_id, created_at DESC);

COMMIT;
