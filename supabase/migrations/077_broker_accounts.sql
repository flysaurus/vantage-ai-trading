-- ═══════════════════════════════════════════════════════════════
-- Migration 077: broker_accounts — first-class sub-account rows
-- Run in: Supabase SQL Editor (idempotent)   ·   Part B, STEP 1 of 6
--
-- Scope of THIS migration (deliberately minimal — additive only):
--   1. CREATE TABLE broker_accounts  (1 row per broker sub-account)
--   2. Add a nullable account-scope FK to positions / orders / trade_history
--   3. Add a nullable account-scope FK to position_lots under a NEW name
--   4. Indexes + comments + RLS (server-side only)
--
-- ❌ NO BACKFILL IN THIS STEP (no UPDATE/INSERT into the new columns; the
--    table starts empty on purpose). Backfill is step 2/3 and is a separate
--    review. Rows whose owner cannot be *proven* stay NULL — never guessed.
-- ❌ NO DROPS, NO TYPE CHANGES, NO NOT NULL. Rollback = DROP the table +
--    the columns (nothing in the current app reads or writes them yet).
--
-- Why: one SnapTrade *login* (broker_connections row) can expose many
-- accounts, and the existing model conflates the two. `positions`, `orders`
-- and `trade_history` are scoped only by connection_id, so any
-- connection-scoped query SUMS the accounts of a shared login (this is the
-- live Fidelity bug: $377,551.36 + $22,803.88 shown as $400,355.24).
-- Full plan + evidence: docs/part-b-account-model-migration.md
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. broker_accounts — 1 row per sub-account under one login
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.broker_accounts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL
                          REFERENCES public.broker_connections(id) ON DELETE CASCADE,
  snaptrade_account_id  TEXT NOT NULL UNIQUE,
  name                  TEXT,
  account_type          TEXT,
  currency              TEXT,
  is_default            BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open', 'closed', 'archived')),
  raw                   JSONB,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.broker_accounts IS
  'One row per broker sub-account. A broker_connections row = one LOGIN and may own many of these; derived data (positions/orders/trade_history/lots) is being re-pointed from the connection to the specific account. Additive — nothing reads it until Part B step 4 (dual-read).';
COMMENT ON COLUMN public.broker_accounts.snaptrade_account_id IS
  'Upstream SnapTrade account id (the middle segment of the canonical `snaptrade:<connectionId>:<snapAccountId>` account key). UNIQUE.';
COMMENT ON COLUMN public.broker_accounts.raw IS
  'Last seen SnapTrade payload for this account (id / name / number / totalValue / buyingPower). Informational only — never a source of truth for balances.';
COMMENT ON COLUMN public.broker_accounts.status IS
  'open = usable; closed/archived = kept for tax history but hidden from switching (see Part B open questions).';

CREATE INDEX IF NOT EXISTS idx_broker_accounts_connection
  ON public.broker_accounts(connection_id);

-- Same security model as 076: RLS on, NO permissive policies. Every read and
-- write goes through the service-role client server-side.
ALTER TABLE public.broker_accounts ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────
-- 2. Derived tables: nullable account scope
--    ON DELETE SET NULL — losing an account row must never delete
--    financial history (mirrors the connection_id convention, 048/052).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS account_id UUID
    REFERENCES public.broker_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS account_id UUID
    REFERENCES public.broker_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.trade_history
  ADD COLUMN IF NOT EXISTS account_id UUID
    REFERENCES public.broker_accounts(id) ON DELETE SET NULL;

-- ⚠️ position_lots ALREADY has an `account_id` UUID column — but it is scoped
-- to broker_CONNECTIONS (058, line 57: `account_id UUID REFERENCES
-- broker_connections(id)`), i.e. the same connection-level conflation. The
-- account FK therefore lands under its OWN name here; retargeting the legacy
-- column would be a rename/retype (NOT additive) and would break every FIFO
-- writer. Both columns coexist until the later swap step.
ALTER TABLE public.position_lots
  ADD COLUMN IF NOT EXISTS broker_account_id UUID
    REFERENCES public.broker_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.positions.account_id IS
  'broker_accounts.id that produced this row. NULL = not yet attributed (legacy rows / demo) — never inferred.';
COMMENT ON COLUMN public.orders.account_id IS
  'broker_accounts.id that produced this row. NULL = not yet attributed (legacy rows / demo) — never inferred.';
COMMENT ON COLUMN public.trade_history.account_id IS
  'broker_accounts.id that produced this row. NULL = not yet attributed (legacy rows / demo) — never inferred.';
COMMENT ON COLUMN public.position_lots.broker_account_id IS
  'broker_accounts.id for this lot. Distinct from the legacy `account_id` column, which holds the broker_CONNECTIONS id (058). NULL = not yet attributed — never inferred.';

-- ─────────────────────────────────────────────────────────────
-- 3. Indexes — hot queries are "all rows for a user, scoped to one account"
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_positions_account
  ON public.positions(account_id);

CREATE INDEX IF NOT EXISTS idx_positions_user_account
  ON public.positions(user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_orders_account
  ON public.orders(account_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_account
  ON public.orders(user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_trade_history_account
  ON public.trade_history(account_id);

CREATE INDEX IF NOT EXISTS idx_trade_history_user_account
  ON public.trade_history(user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_position_lots_broker_account
  ON public.position_lots(user_id, broker_account_id);

COMMIT;
