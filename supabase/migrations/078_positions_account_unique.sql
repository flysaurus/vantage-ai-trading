-- ═══════════════════════════════════════════════════════════════
-- Migration: 078 — positions live-uniqueness becomes account-aware
-- Run in: Supabase SQL Editor (idempotent-ish; see note)
-- Context: Part B step 3b (write-side account stamping).
--
-- WHY
-- `idx_positions_live_unique` (migration 053) is
--     UNIQUE (user_id, symbol, connection_id) WHERE is_demo = false
-- i.e. ONE live row per symbol per CONNECTION. That was correct while a
-- connection meant one brokerage account.
--
-- On a shared login (Fidelity: "Taxable SMA - US Large Equity" +
-- "ANIKET -YOUTH ACCOUNT" under one broker_connection) the two sub-accounts
-- legitimately hold the SAME symbol (AAPL, MSFT, NVDA, SPY, TSLA …). Once
-- rows are stamped with `account_id`, the second account's insert fails:
--
--   insert failed: duplicate key value violates unique constraint
--                  "idx_positions_live_unique"
--
-- Observed live 2026-09-16 17:52Z on the ANIKET-YOUTH sync (25 rows), with the
-- SMA sync (349 rows) already staged in the same connection.
--
-- FIX: include account_id in the live uniqueness key. Legacy (unstamped) rows
-- keep account_id NULL; Postgres treats NULLs as distinct in a unique index, so
-- they never collide with each other — exactly as before — while two stamped
-- sub-accounts of one connection can each hold the same symbol.
--
-- NOT A BACKFILL, NOT A DELETE: no row is touched. Only an index is replaced.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Drop only the connection-scoped uniqueness; the demo index is unrelated.
DROP INDEX IF EXISTS public.idx_positions_live_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_live_unique
  ON public.positions(user_id, connection_id, account_id, symbol)
  WHERE is_demo = false;

COMMENT ON INDEX public.idx_positions_live_unique IS
  'One live position per (user, connection, account, symbol). account_id NULL = unattributed legacy row (NULLs are distinct).';

COMMIT;

-- ─── ROLLBACK ────────────────────────────────────────────────
-- Restoring the old index requires that no (user_id, connection_id, symbol)
-- pair exist under two different accountids. If stamped duplicate symbols exist,
-- the CREATE UNIQUE INDEX below will fail — first either drop the stamped rows
--   DELETE FROM public.positions WHERE account_id IS NOT NULL AND is_demo = false;
-- or merge them. Then:
--
-- BEGIN;
--   DROP INDEX IF EXISTS public.idx_positions_live_unique;
--   CREATE UNIQUE INDEX idx_positions_live_unique
--     ON public.positions(user_id, symbol, connection_id)
--     WHERE is_demo = false;
-- COMMIT;

-- ─── VERIFY (read-only) ──────────────────────────────────────
-- SELECT indexdef FROM pg_indexes
--  WHERE schemaname = 'public' AND indexname = 'idx_positions_live_unique';
-- -- expect: ... USING btree (user_id, connection_id, account_id, symbol) WHERE (is_demo = false)
