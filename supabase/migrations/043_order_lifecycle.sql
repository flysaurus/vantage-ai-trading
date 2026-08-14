-- ─────────────────────────────────────────────────────────────────────────────
-- 043_order_lifecycle.sql
-- Establish `orders` as the single canonical source of truth for the order
-- lifecycle (Open / Filled / Cancelled tabs).
--
-- Changes:
--   1. updated_at   — sync-engine transition tracking
--   2. cancelled_at — real broker cancellation timestamp (dual-cancel feature)
--   3. Normalize legacy status values → canonical enum (BEFORE adding CHECK)
--   4. status CHECK constraint: submitted|open|partially_filled|filled|cancelled|rejected
--   5. UPDATE RLS policy (orders currently has only SELECT + INSERT)
--   6. Backfill orders ← trade_history (filled trades; no-op on empty table)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 ── updated_at ──────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 2 ── cancelled_at ────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- 3 ── Normalize legacy status values BEFORE adding the CHECK ─────────────────
UPDATE public.orders
SET status = CASE lower(status)
  WHEN 'executed'             THEN 'filled'
  WHEN 'pending'              THEN 'submitted'
  WHEN 'pending_new'          THEN 'submitted'
  WHEN 'new'                  THEN 'submitted'
  WHEN 'accepted'             THEN 'submitted'
  WHEN 'accepted_for_bidding' THEN 'submitted'
  WHEN 'queued'               THEN 'submitted'
  WHEN 'sent'                 THEN 'submitted'
  WHEN 'placed'               THEN 'submitted'
  WHEN 'submitted_to_broker'  THEN 'submitted'
  WHEN 'partial'              THEN 'partially_filled'
  WHEN 'canceled'             THEN 'cancelled'
  WHEN 'expired'              THEN 'cancelled'
  WHEN 'failed'               THEN 'rejected'
  ELSE 'open'
END
WHERE status IS NULL
   OR lower(status) NOT IN ('submitted','open','partially_filled','filled','cancelled','rejected');

-- 4 ── status CHECK constraint + sane default ──────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_status_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_status_check
      CHECK (status IN ('submitted','open','partially_filled','filled','cancelled','rejected'));
  END IF;
END $$;

ALTER TABLE public.orders ALTER COLUMN status SET DEFAULT 'submitted';

-- 5 ── UPDATE RLS policy (orders currently has only SELECT + INSERT) ───────────
DROP POLICY IF EXISTS "orders_update_own" ON public.orders;
CREATE POLICY "orders_update_own" ON public.orders
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 6 ── Backfill: orders ← trade_history ────────────────────────────────────────
-- NOTE (2026-08-14): prod trade_history is EMPTY and its real schema is leaner
-- than supabase/schema.sql — it has (id, user_id, symbol, action, quantity,
-- price, created_at, commission, notes, executed_at, updated_at) and is MISSING
-- qty/side/type/status/filled_price/filled_at/alpaca_order_id. Every
-- trade_history row is a filled trade by design, so status='filled' and
-- order_type='market' are hardcoded. This is a no-op on the empty table but
-- will work if rows are ever added.
DO $$
BEGIN
  IF to_regclass('public.trade_history') IS NOT NULL THEN
    INSERT INTO public.orders (
      id, user_id, symbol, qty, filled_qty, side, order_type, status,
      filled_price, filled_at, time_in_force, is_demo, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      t.user_id,
      t.symbol,
      COALESCE(t.quantity, 0)::numeric,
      COALESCE(t.quantity, 0)::numeric,
      COALESCE(t.action, 'buy'),
      'market',
      'filled',
      t.price,
      COALESCE(t.executed_at, t.created_at, now()),
      'day',
      false,
      COALESCE(t.executed_at, t.created_at, now()),
      now()
    FROM trade_history t
    WHERE COALESCE(t.quantity, 0) > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.user_id = t.user_id
          AND o.symbol = t.symbol
          AND o.created_at = COALESCE(t.executed_at, t.created_at)
      );
  END IF;
END $$;
