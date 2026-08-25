-- ═══════════════════════════════════════════════════════════════
-- Migration 059: Persisted order company names
-- Run in: Supabase SQL Editor (idempotent)
--
-- Adds a `company_name` column to `orders` so the full company/ETF
-- name is captured ONCE at order-placement time (and backfilled for
-- historical orders), eliminating the fragile live Yahoo lookups the
-- order cards + Portfolio positions previously did on every render.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS company_name TEXT;

COMMENT ON COLUMN public.orders.company_name IS
  'Full company/ETF name resolved at order placement. Backfilled for historical orders. NULL = unresolved (fallback to symbol).';

CREATE INDEX IF NOT EXISTS idx_orders_company_name
  ON public.orders(company_name) WHERE company_name IS NOT NULL;
