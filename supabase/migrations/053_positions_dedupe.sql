-- ═══════════════════════════════════════════════════════════════
-- Migration: positions dedupe — remove NULL-connection_id duplicates
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: Migration 048 added positions.connection_id but did NOT backfill
--          existing rows. A subsequent sync re-inserted the same live
--          positions WITH connection_id set, leaving the old NULL-connection_id
--          rows behind as duplicates (same user/symbol/qty). Those NULL rows
--          leak into any non-connection-filtered read path and double-count.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Delete non-demo positions that have NO connection_id but DO have a
-- matching row (same user + symbol) that DOES have a connection_id.
DELETE FROM public.positions p
WHERE p.connection_id IS NULL
  AND p.is_demo = false
  AND EXISTS (
    SELECT 1
    FROM public.positions p2
    WHERE p2.user_id = p.user_id
      AND p2.symbol = p.symbol
      AND p2.is_demo = false
      AND p2.connection_id IS NOT NULL
  );

-- Prevent re-duplication: one live position per (user, symbol, connection).
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_live_unique
  ON public.positions(user_id, symbol, connection_id)
  WHERE is_demo = false;

-- Demo positions: one per (user, symbol).
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_demo_unique
  ON public.positions(user_id, symbol)
  WHERE is_demo = true;

COMMIT;
