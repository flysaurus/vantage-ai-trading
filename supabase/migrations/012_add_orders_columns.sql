-- Migration 012: Add orders + basket_orders columns to demo_portfolio_state
-- These store active (OPEN/PARTIALLY_FILLED) orders for the server-side order processor.
-- DemoBroker already syncs these via upsert() — the catch() suppressed the column-not-found error.
-- After this migration, DemoBroker syncs will succeed and the execute-pending-orders cron can read them.

ALTER TABLE demo_portfolio_state 
ADD COLUMN IF NOT EXISTS orders JSONB DEFAULT '[]'::jsonb;

ALTER TABLE demo_portfolio_state 
ADD COLUMN IF NOT EXISTS basket_orders JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN demo_portfolio_state.orders IS 'Active broker orders (OPEN, PARTIALLY_FILLED, FILLED, CANCELLED). FILLED/CANCELLED orders stay for history.';
COMMENT ON COLUMN demo_portfolio_state.basket_orders IS 'Active basket-level order groups with per-symbol order IDs and reserved costs.';
