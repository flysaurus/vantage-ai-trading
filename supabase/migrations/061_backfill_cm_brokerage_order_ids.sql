-- ═══════════════════════════════════════════════════════════════
-- Backfill 061: Restore brokerage_order_id for the 6 Critical Minerals basket legs
-- Run in: Supabase SQL Editor (idempotent)
--
-- Context (order-lifecycle trust audit, Part 3):
--   The "Critical Minerals" basket buy placed 6 dollar-denominated BUY legs
--   (MP, LAC, UUUU, ALB, CPER, NEM) through Vantage. The broker (Alpaca via
--   SnapTrade) executed all 6, but Vantage failed to persist the broker's
--   brokerage_order_id back onto these 6 `orders` rows (they remain NULL).
--
--   Reconciliation flagged exactly 6 `externalOrders` (broker EXECUTED fills
--   with no matching Vantage brokerage_order_id) AND exactly 6 Vantage
--   `filled` orders with brokerage_order_id = NULL. They are the SAME 6
--   trades — matched here on (symbol, filled_qty, filled_price).
--
--   Fixing the linkage collapses the double-show in the Invest tab (each leg
--   currently appears as BOTH a Vantage order and a broker order) and makes
--   the dedup key broker-authoritative.
--
--   origin stays 'vantage' — these were placed THROUGH Vantage; only the
--   broker order-id write-back was lost.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.orders SET brokerage_order_id = 'b0b9bc80-b417-449f-a626-cf7057055476'
  WHERE id = 'b8531bc0-2c5a-452a-99cc-7a4187433eb8' AND brokerage_order_id IS NULL;

UPDATE public.orders SET brokerage_order_id = 'a82e04a1-540a-4038-acb6-ae9a3bb91d3d'
  WHERE id = '488bfddb-8347-49e1-bb0e-bc537e172f1e' AND brokerage_order_id IS NULL;

UPDATE public.orders SET brokerage_order_id = '959fa04a-dbac-426b-9749-a8845c272136'
  WHERE id = 'dc08299c-ca59-4911-a302-13dd80c1c2e3' AND brokerage_order_id IS NULL;

UPDATE public.orders SET brokerage_order_id = '4ab456cc-95b7-4092-adda-504a853fdcaf'
  WHERE id = '82de6909-2933-4c2a-a931-c21410a7a87c' AND brokerage_order_id IS NULL;

UPDATE public.orders SET brokerage_order_id = 'bc9199e0-e5a5-47c7-bcf7-9fc62c093a9e'
  WHERE id = 'ccf68ece-be69-4ade-a040-08993754702f' AND brokerage_order_id IS NULL;

UPDATE public.orders SET brokerage_order_id = '693408c7-e097-4571-b533-9318024a9648'
  WHERE id = 'd5cc345e-b889-45c2-95ce-ac43bede0f2a' AND brokerage_order_id IS NULL;

COMMIT;
