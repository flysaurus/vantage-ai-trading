-- 2026-08-08: Add brokerage_order_id to orders table
-- Purpose: Store the SnapTrade/Alpaca brokerage_order_id so we can audit
-- whether an order actually reached the broker (vs. failing pre-SnapTrade).
-- Sentinel values ('error', 'no-account', etc.) must NOT be stored.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS brokerage_order_id text;
COMMENT ON COLUMN public.orders.brokerage_order_id IS 'SnapTrade brokerage_order_id from /trade/place response. NULL = order never reached broker.';

-- Index for lookups by broker order ID
CREATE INDEX IF NOT EXISTS orders_brokerage_id_idx ON public.orders(brokerage_order_id) WHERE brokerage_order_id IS NOT NULL;
