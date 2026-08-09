-- Migration: Add notional (dollar amount) column to orders table
-- For dollar-based orders (e.g. "buy $500 of AAPL"), notional stores the
-- dollar amount; qty stores the approximate share count.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notional numeric;
COMMENT ON COLUMN public.orders.notional IS 'Dollar amount for notional_value orders (null for share-based orders)';
