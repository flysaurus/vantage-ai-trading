-- ═══════════════════════════════════════════════════════════════
-- Migration: trade_history.connection_id + is_demo — account scoping
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: trade_history currently stores filled trades user-scoped only
--          (no connection_id, no is_demo) — live trades from different
--          brokers would mix, and demo/live would mix. Mirrors the
--          orders.connection_id fix (052). Prod table is empty today so
--          backfill is a no-op, but this keeps it correct before it fills.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.trade_history
  ADD COLUMN IF NOT EXISTS connection_id UUID
  REFERENCES public.broker_connections(id) ON DELETE SET NULL;

ALTER TABLE public.trade_history
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_trade_history_user_connection
  ON public.trade_history(user_id, connection_id, executed_at DESC);

COMMIT;
