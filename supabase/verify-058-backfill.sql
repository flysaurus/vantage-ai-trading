-- ═══════════════════════════════════════════════════════════
-- verify-058-backfill.sql
-- Post-migration sanity check for the position_lots backfill.
--
-- Run in the Supabase SQL editor AFTER migration 058 has been
-- applied. Expected results (healthy state):
--   • missing_lots        = 0   (every filled BUY has a lot)
--   • duplicate_order_lots = 0  (no order double-counted)
--   • negative_remaining  = 0   (no over-consumption)
--   • over_qty            = 0   (remaining never exceeds qty)
--
-- Note: orders.side / orders.status are stored LOWERCASE
-- ('buy' / 'filled') — matches migration 058's backfill filter.
-- ═══════════════════════════════════════════════════════════

-- 1. Total lot-ledger size
SELECT count(*) AS total_lots FROM public.position_lots;

-- 2. Lot breakdown by origin_tag (backfill + live createLotForBuy
--    both set order_id, so everything should be order-linked except
--    genuinely external broker-discovered lots from Phase 2).
SELECT
  count(*)                                             AS order_linked_lots,
  count(*) FILTER (WHERE origin_tag = 'basket_buy')     AS basket_buy,
  count(*) FILTER (WHERE origin_tag = 'buy_more')       AS buy_more,
  count(*) FILTER (WHERE origin_tag = 'standalone_buy') AS standalone_buy,
  count(*) FILTER (WHERE origin_tag = 'external')       AS external,
  count(*) FILTER (WHERE origin_tag IS NULL)            AS null_origin
FROM public.position_lots;

-- 3. ⚠️ MISSING LOTS — filled BUY orders with no matching lot.
--    Should be 0. If > 0, the backfill skipped orders.
SELECT count(*) AS missing_lots
FROM public.orders o
WHERE o.side = 'buy'
  AND o.status = 'filled'
  AND COALESCE(o.filled_qty, o.qty, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.position_lots pl WHERE pl.order_id = o.id
  );

-- 4. ⚠️ DUPLICATE LOTS — one order_id with more than one lot.
--    Should be 0 (createLotForBuy is idempotent on order_id).
SELECT order_id, count(*) AS lot_count
FROM public.position_lots
WHERE order_id IS NOT NULL
GROUP BY order_id
HAVING count(*) > 1;

-- 5. ⚠️ NEGATIVE REMAINING — remaining_qty should never go below 0.
SELECT count(*) AS negative_remaining
FROM public.position_lots
WHERE remaining_qty < 0;

-- 6. ⚠️ OVER-CONSUMED — remaining_qty should never exceed qty.
SELECT count(*) AS over_qty
FROM public.position_lots
WHERE remaining_qty > qty;
