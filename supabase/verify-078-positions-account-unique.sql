-- ═══════════════════════════════════════════════════════════════
-- verify-078 — read-only checks for migration 078
-- Run in: Supabase SQL Editor. Makes NO writes.
-- ═══════════════════════════════════════════════════════════════

-- 1. The live index is now account-aware
SELECT indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_positions_live_unique';
-- expect: USING btree (user_id, connection_id, account_id, symbol) WHERE (is_demo = false)

-- 2. The demo index is untouched
SELECT indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'idx_positions_demo_unique';
-- expect: USING btree (user_id, symbol) WHERE (is_demo = true)

-- 3. No row was modified by the migration (counts hold)
SELECT
  count(*)                                                AS total,
  count(*) FILTER (WHERE account_id IS NOT NULL)           AS attributed,
  count(*) FILTER (WHERE account_id IS NULL AND is_demo=false) AS unattributed_live,
  count(*) FILTER (WHERE is_demo)                          AS demo
FROM public.positions;

-- 4. Per-account attribution per connection (should show SMA's 349 and,
--    after the second sync, ANIKET's 25 — same connection, no collisions)
SELECT connection_id, account_id, count(*) AS rows
  FROM public.positions
 WHERE is_demo = false
 GROUP BY connection_id, account_id
 ORDER BY connection_id, account_id NULLS LAST;

-- 5. Proof the collision is gone: symbols held by more than one account
--    inside the SAME connection (expected, now legal)
SELECT connection_id, symbol, count(DISTINCT account_id) AS accounts
  FROM public.positions
 WHERE is_demo = false AND account_id IS NOT NULL
 GROUP BY connection_id, symbol
HAVING count(DISTINCT account_id) > 1
 ORDER BY accounts DESC, symbol
 LIMIT 20;
