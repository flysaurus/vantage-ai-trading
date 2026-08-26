-- ═══════════════════════════════════════════════════════════════
-- Migration 060: orders.origin — placement origin (vantage vs external)
-- Run in: Supabase SQL Editor (idempotent)
--
-- Source attribution for the order-lifecycle trust audit: distinguish
-- orders placed *inside* Vantage from orders placed *directly at the
-- broker* (e.g. the Alpaca dashboard) and later synced into Vantage.
--
--   'vantage'  → placed via the Vantage UI/API (trade ticket, sell,
--                basket, AI Advisor). DEFAULT — every existing row
--                backfills to this (they were all placed in Vantage).
--   'external' → placed at the broker outside Vantage; ingested by the
--                sync path so the ledger stays broker-authoritative.
--
-- The UI derives the broker display name from
--   connection_id → broker_connections.brokerage_slug → formatBrokerName()
-- (no denormalized name column needed).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'vantage';

COMMENT ON COLUMN public.orders.origin IS
  'Placement origin: ''vantage'' (placed via Vantage) or ''external'' (placed directly at the broker, synced in). Defaults to ''vantage'' for all pre-existing rows.';

CREATE INDEX IF NOT EXISTS idx_orders_origin
  ON public.orders(origin) WHERE origin IS NOT NULL;
