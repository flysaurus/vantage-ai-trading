-- ═══════════════════════════════════════════════════════════════
-- Backfill 062: Reconciliation lots for 9 externally-acquired positions
-- Run in: Supabase SQL Editor (idempotent)
--
-- ⚠️  OPTIONAL — see design note at bottom before running.
--
-- Context (order-lifecycle trust audit, Part 3):
--   `positions` is synced authoritatively from the broker (qty + avg_cost
--   match 1:1 — zero drift). The FIFO `position_lots` ledger, however, only
--   contains lots for BUY orders that Vantage actually ingested. Positions
--   acquired OUTSIDE Vantage (or before lot tracking existed) therefore have
--   missing lots:
--
--     TSLA, SPCX, CAT, IWM, HCA  → ZERO lots (fully external/legacy)
--     CVX, VOO, QQQ, AAPL        → partial (a large/small external residual)
--
--   This does NOT cause display drift: PositionCardV3 already falls back to
--   the broker's avg_cost when a position has 0 tracked lots, and
--   consumeLotsForSell() degrades gracefully (shortfall is logged, not fatal).
--
--   These inserts COMPLETE the ledger so future sells track cost basis. Each
--   reconciliation lot is priced so the position's weighted-average cost
--   equals the broker's avg_cost EXACTLY (no drift introduced):
--
--     reconP = (posQty·avgCost − trackedQty·trackedAvg) / shortfall
--            = avgCost  (when zero tracked lots)
--
--   Prices below were computed from live broker data on 2026-08-26.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Fully-external positions (reconP = broker avg_cost)
INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'TSLA', 10, 10, 311, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='TSLA' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'SPCX', 7.396739533, 7.396739533, 135.19335, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='SPCX' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'CAT', 1.29038956, 1.29038956, 852.448, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='CAT' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'IWM', 0.49346932, 0.49346932, 303.95, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='IWM' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'HCA', 0.119678049, 0.119678049, 417.704, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='HCA' AND pl.origin_tag='broker_reconciliation');

-- Partially-tracked positions (reconP balances the weighted avg to broker avg_cost)
INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'CVX', 6.332911725, 6.332911725, 189.484719529, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='CVX' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'VOO', 0.840781379, 0.840781379, 713.609995406, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='VOO' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'QQQ', 0.341143558, 0.341143558, 732.800001621, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='QQQ' AND pl.origin_tag='broker_reconciliation');

INSERT INTO public.position_lots (user_id, account_id, ticker, qty, remaining_qty, price_at_fill, filled_at, source, order_id, origin_tag)
SELECT '58ffa82a-2b14-4a5d-9662-5c48f105031f', 'ae013e41-06b3-4f7e-83a1-74b8a54ad207', 'AAPL', 0.130285936, 0.130285936, 306.709974407, now(), 'snaptrade', NULL, 'broker_reconciliation'
WHERE NOT EXISTS (SELECT 1 FROM public.position_lots pl WHERE pl.user_id='58ffa82a-2b14-4a5d-9662-5c48f105031f' AND pl.account_id='ae013e41-06b3-4f7e-83a1-74b8a54ad207' AND pl.ticker='AAPL' AND pl.origin_tag='broker_reconciliation');

COMMIT;

-- ─────────────────────────────────────────────────────────────
-- DESIGN NOTE
-- ─────────────────────────────────────────────────────────────
-- 1. Migration 058 DELIBERATELY skipped synthetic lots for positions with no
--    real `orders` row ("only actual orders records get backfilled"). This
--    backfill overrides that choice to complete the ledger.
-- 2. `source='snaptrade'` marks these as broker-detected (not placed via the
--    Vantage trade ticket). `origin_tag='broker_reconciliation'` is a NEW tag
--    distinct from the 058 set (standalone_buy|basket_buy|external) so it is
--    greppable/reversible.
-- 3. `filled_at = now()` — reconciliation lots become the NEWEST lot, so FIFO
--    consumes real historical lots first, then this residual. The weighted
--    average cost is broker-exact regardless of FIFO order.
-- 4. Reversibility: DELETE FROM position_lots WHERE origin_tag =
--    'broker_reconciliation' AND user_id = '58ffa82a-...' restores the prior
--    (incomplete) state with zero side effects.
-- ─────────────────────────────────────────────────────────────
