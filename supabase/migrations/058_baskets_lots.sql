-- ═══════════════════════════════════════════════════════════════
-- Migration 058: Basket System + Position Lots (Phase 1)
-- Run in: Supabase SQL Editor (idempotent)
-- Feature Brief: OPENCLAW_BRIEF — Basket System + System-Wide Lot Tracking
-- ═══════════════════════════════════════════════════════════════
--
-- Creates:
--   1. user_baskets — persistent user-owned basket entity
--   2. ALTER orders ADD basket_id — link orders to a basket
--   3. position_lots — FIFO lot-tracking for every position
--   4. Backfill: one position_lots row per existing filled BUY order
--   5. Indexes + RLS policies
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. user_baskets — persistent user-owned baskets
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_baskets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  theme_label TEXT,
  icon TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'liquidated')),
  connection_id UUID REFERENCES public.broker_connections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.user_baskets IS 'User-owned baskets that persist across Buy More/Sell actions. Distinct from the AI-curated `baskets` table which is a static catalog.';
COMMENT ON COLUMN public.user_baskets.connection_id IS 'The broker connection this basket was created under (NULL = demo).';
COMMENT ON COLUMN public.user_baskets.status IS 'active = holding positions, closed = sold all, liquidated = explicitly liquidated via Sell All.';

CREATE INDEX IF NOT EXISTS idx_user_baskets_user
  ON public.user_baskets(user_id, status, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 2. Link orders to a user_basket
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS basket_id UUID
  REFERENCES public.user_baskets(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.orders.basket_id IS 'The user_basket this order belongs to (NULL = standalone order).';

CREATE INDEX IF NOT EXISTS idx_orders_basket
  ON public.orders(basket_id) WHERE basket_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3. position_lots — FIFO-aware lot ledger
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.position_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.broker_connections(id) ON DELETE SET NULL,
  basket_id UUID REFERENCES public.user_baskets(id) ON DELETE SET NULL,
  ticker TEXT NOT NULL,
  qty NUMERIC NOT NULL,
  remaining_qty NUMERIC NOT NULL,
  price_at_fill NUMERIC NOT NULL,
  filled_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,  -- 'vantage' | broker slug e.g. 'alpaca'
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  origin_tag TEXT,       -- 'basket_buy' | 'buy_more' | 'standalone_buy' | 'external'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.position_lots IS 'FIFO lot ledger: every buy creates one or more lots; sells consume remaining_qty oldest-first.';
COMMENT ON COLUMN public.position_lots.account_id IS 'Broker connection. NULL = demo account.';
COMMENT ON COLUMN public.position_lots.basket_id IS 'Nullable — most standalone positions do not have one.';
COMMENT ON COLUMN public.position_lots.remaining_qty IS 'Shares still available. 0 = fully consumed by sells.';
COMMENT ON COLUMN public.position_lots.source IS 'vantage (placed through app) or broker slug e.g. alpaca (detected externally).';
COMMENT ON COLUMN public.position_lots.origin_tag IS 'basket_buy | buy_more | standalone_buy | external. NULL = legacy backfill.';

CREATE INDEX IF NOT EXISTS idx_position_lots_user_ticker
  ON public.position_lots(user_id, ticker, account_id);
CREATE INDEX IF NOT EXISTS idx_position_lots_user_basket
  ON public.position_lots(user_id, basket_id) WHERE basket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_position_lots_order
  ON public.position_lots(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_position_lots_remaining
  ON public.position_lots(user_id, ticker, account_id, filled_at ASC)
  WHERE remaining_qty > 0;

-- ─────────────────────────────────────────────────────────────
-- 4. Backfill: one position_lots row per existing filled BUY
-- ─────────────────────────────────────────────────────────────
-- Only runs once — creates a lot for every historical filled BUY order.
-- Lot-level qty = filled_qty; remaining_qty = filled_qty (not yet consumed).
-- Standalone/trade_history BUYs that lack a real `orders` row do NOT get
-- a synthetic lot (only actual orders records get backfilled).

DO $$
DECLARE
  backfill_count integer;
BEGIN
  -- Count before
  SELECT COUNT(*) INTO backfill_count
  FROM public.orders o
  WHERE o.side = 'buy'
    AND o.status = 'filled'
    AND COALESCE(o.filled_qty, o.qty, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.position_lots pl WHERE pl.order_id = o.id
    );

  RAISE NOTICE '[058] Backfill: % filled BUY orders need lots', backfill_count;

  INSERT INTO public.position_lots (
    user_id, account_id, ticker, qty, remaining_qty,
    price_at_fill, filled_at, source, order_id, origin_tag
  )
  SELECT
    o.user_id,
    o.connection_id,
    o.symbol,
    COALESCE(o.filled_qty, o.qty, 0),
    COALESCE(o.filled_qty, o.qty, 0),
    COALESCE(o.filled_price, 0),
    COALESCE(o.filled_at, o.created_at, now()),
    CASE WHEN o.is_demo THEN 'vantage'
         ELSE COALESCE(
           (SELECT bc.connection_type FROM public.broker_connections bc WHERE bc.id = o.connection_id),
           'vantage'
         )
    END,
    o.id,
    CASE WHEN o.basket_id IS NOT NULL THEN 'basket_buy' ELSE 'standalone_buy' END
  FROM public.orders o
  WHERE o.side = 'buy'
    AND o.status = 'filled'
    AND COALESCE(o.filled_qty, o.qty, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.position_lots pl WHERE pl.order_id = o.id
    );

  GET DIAGNOSTICS backfill_count = ROW_COUNT;
  RAISE NOTICE '[058] Backfill: inserted % position_lots rows', backfill_count;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS policies
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.user_baskets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_lots ENABLE ROW LEVEL SECURITY;

-- user_baskets — full CRUD for owner
CREATE POLICY "user_baskets_read_own" ON public.user_baskets
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_baskets_insert_own" ON public.user_baskets
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "user_baskets_update_own" ON public.user_baskets
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "user_baskets_delete_own" ON public.user_baskets
  FOR DELETE USING (auth.uid() = user_id);

-- position_lots — read + insert for owner (lots are immutable after creation)
CREATE POLICY "position_lots_read_own" ON public.position_lots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "position_lots_insert_own" ON public.position_lots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
-- UPDATE allowed for remaining_qty decrements during FIFO consumption
CREATE POLICY "position_lots_update_own" ON public.position_lots
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 6. updated_at trigger for user_baskets
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_baskets_updated_at'
  ) THEN
    CREATE TRIGGER trg_user_baskets_updated_at
      BEFORE UPDATE ON public.user_baskets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMIT;