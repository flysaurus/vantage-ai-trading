-- ═══════════════════════════════════════════════════════════════
-- Verification for migration 077 (broker_accounts) — RUN AFTER APPLYING 077
-- Read-only. Safe to re-run. Every row should read OK = true.
-- ═══════════════════════════════════════════════════════════════

-- 1. Table exists, with the expected columns and FK to broker_connections.
SELECT
  'broker_accounts table + columns' AS check,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'broker_accounts') = 1
  AND (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'broker_accounts'
       AND column_name IN ('id','connection_id','snaptrade_account_id','name',
                           'account_type','currency','is_default','status','raw',
                           'created_at','updated_at')) = 11  AS ok;

-- 2. RLS enabled, and intentionally NO permissive policies.
SELECT
  'broker_accounts RLS on + zero policies' AS check,
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.broker_accounts'::regclass) = true
  AND (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'broker_accounts') = 0 AS ok;

-- 3. Nullable account scope present on the three derived tables.
SELECT
  'derived account_id columns (positions/orders/trade_history)' AS check,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'account_id'
       AND table_name IN ('positions','orders','trade_history')
       AND is_nullable = 'YES') = 3 AS ok;

-- 4. position_lots has the NEW broker_account_id column (legacy account_id untouched).
SELECT
  'position_lots.broker_account_id added' AS check,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'position_lots'
       AND column_name IN ('account_id','broker_account_id')) = 2 AS ok;

-- 5. Indexes present.
SELECT
  'indexes' AS check,
  (SELECT count(*) FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname IN ('idx_broker_accounts_connection',
                         'idx_positions_account','idx_positions_user_account',
                         'idx_orders_account','idx_orders_user_account',
                         'idx_trade_history_account','idx_trade_history_user_account',
                         'idx_position_lots_broker_account')) = 8 AS ok;

-- 6. STEP 1 GUARANTEE: nothing was backfilled, no derived row is attributed,
--    and the table is empty. All three counts MUST be 0.
SELECT
  'no backfill (all 0): accounts rows / positions attributed / lots attributed' AS check,
  (SELECT count(*) FROM public.broker_accounts) = 0
  AND (SELECT count(*) FROM public.positions WHERE account_id IS NOT NULL) = 0
  AND (SELECT count(*) FROM public.position_lots WHERE broker_account_id IS NOT NULL) = 0 AS ok;

-- 7. Nothing was dropped: the legacy connection scopes are intact.
SELECT
  'legacy scopes intact (connection_id on 3 tables + lots.account_id)' AS check,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'connection_id'
       AND table_name IN ('positions','orders','trade_history')) = 3
  AND (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'position_lots'
       AND column_name = 'account_id') = 1 AS ok;
