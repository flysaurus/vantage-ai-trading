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
--   6. Backfill orders ← trade_history (filled rows only, dedup by brokerage_order_id)
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

-- 6 ── Backfill: orders ← trade_history (filled rows only) ─────────────────────
DO $$
BEGIN
  IF to_regclass('public.trade_history') IS NOT NULL THEN
    INSERT INTO public.orders (
      id, user_id, symbol, qty, filled_qty, side, order_type, status,
      filled_price, filled_at, time_in_force, is_demo,
      brokerage_order_id, created_at, updated_at
    )
    SELECT
      gen_random_uuid(),
      t.user_id,
      t.symbol,
      COALESCE(t.quantity, t.qty, 0)::numeric,
      COALESCE(t.quantity, t.qty, 0)::numeric,
      COALESCE(t.action, t.side, 'buy'),
      COALESCE(t.type, 'market'),
      'filled',
      COALESCE(t.filled_price, t.price),
      COALESCE(t.filled_at, t.executed_at, t.created_at, now()),
      'day',
      false,
      t.alpaca_order_id,
      COALESCE(t.executed_at, t.created_at, now()),
      now()
    FROM trade_history t
    WHERE t.status = 'filled'
      AND t.alpaca_order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.orders o WHERE o.brokerage_order_id = t.alpaca_order_id
      );
  END IF;
END $$;
