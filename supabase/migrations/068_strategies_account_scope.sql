-- ─── 068_strategies_account_scope ──────────────────────────────────────────
-- Account-level data segregation for `strategies` (DCA / rebalancing /
-- tax-loss-harvesting schedules).
--
-- Previously `strategies` was scoped by user_id ONLY, so a strategy (e.g. a DCA)
-- created under one account could surface under another account of the same user,
-- and (worse) a demo-created DCA would fire REAL orders against the live broker.
--
-- This migration mirrors the orders/positions convention: a `connection_id`
-- (broker_connections.id) for live/paper accounts + an `is_demo` flag for the
-- demo portfolio. The scheduler only ever executes `is_demo = false` rows and
-- resolves the broker via the explicit `connection_id` (no more ambiguous
-- "exactly one broker" resolution).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. Add the account-scope columns (idempotent).
ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;

ALTER TABLE public.strategies
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.strategies.connection_id IS
  'broker_connections.id for live/paper strategies. NULL for demo strategies.';
COMMENT ON COLUMN public.strategies.is_demo IS
  'true = demo strategy (never executes live orders). false = live/paper.';

-- 2. Backfill legacy live rows to the user''s sole connected broker.
--    All pre-existing strategies were broker-executed (there was no demo path),
--    so every legacy row is live. Attach each to the user''s oldest connected
--    snap-trade broker; rows whose user has no broker left with a NULL
--    connection (the scheduler will skip them softly).
UPDATE public.strategies s
SET connection_id = (
  SELECT bc.id
  FROM public.broker_connections bc
  WHERE bc.user_id = s.user_id
    AND bc.connection_type = 'snaptrade'
    AND bc.status = 'connected'
  ORDER BY bc.created_at ASC
  LIMIT 1
)
WHERE s.is_demo = false
  AND s.connection_id IS NULL;

-- 3. Indexes for the common scope lookups.
CREATE INDEX IF NOT EXISTS idx_strategies_user_connection
  ON public.strategies(user_id, connection_id);

CREATE INDEX IF NOT EXISTS idx_strategies_user_demo
  ON public.strategies(user_id) WHERE is_demo = true;

COMMIT;
