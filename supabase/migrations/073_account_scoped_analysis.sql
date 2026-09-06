-- 073: Account-scoped AI analysis (Noticed feed + idle-cash snapshots)
--
-- The Noticed rules engine (concentration / drift / idle-cash / earnings /
-- sentiment) and the idle-cash streak were keyed by user_id only, so a user
-- with multiple broker connections (demo + Fidelity + Alpaca + ...) had all
-- positions merged into ONE blended portfolio. Triggers therefore fired on a
-- fake combined book instead of per-account.
--
-- This migration adds an `account_id` (canonical string: 'demo' or
-- 'snaptrade:<broker_connections.id>') to both tables and widens their unique
-- keys to (user_id, account_id, ...). Existing rows are user-level blends and
-- are wiped — they regenerate per-account on the next pipeline run (cron or
-- on-demand POST /api/ai/noticed).

-- ── 1. noticed_items ──────────────────────────────────────────
ALTER TABLE public.noticed_items
  ADD COLUMN IF NOT EXISTS account_id TEXT;

-- Drop the old user-level unique key so the same trigger can exist per account.
ALTER TABLE public.noticed_items
  DROP CONSTRAINT IF EXISTS noticed_items_user_id_trigger_key_key;

-- Wipe user-level blended rows (regenerate per-account on next run).
DELETE FROM public.noticed_items;

ALTER TABLE public.noticed_items
  ADD CONSTRAINT noticed_items_user_id_account_id_trigger_key_key
  UNIQUE (user_id, account_id, trigger_key);

DROP INDEX IF EXISTS idx_noticed_user_visible;
CREATE INDEX IF NOT EXISTS idx_noticed_user_account_visible
  ON public.noticed_items(user_id, account_id, resolved, dismissed_until)
  WHERE resolved = false;

-- ── 2. daily_cash_snapshots (idle-cash) ───────────────────────
ALTER TABLE public.daily_cash_snapshots
  ADD COLUMN IF NOT EXISTS account_id TEXT;

ALTER TABLE public.daily_cash_snapshots
  DROP CONSTRAINT IF EXISTS daily_cash_snapshots_user_id_date_key;

DELETE FROM public.daily_cash_snapshots;

ALTER TABLE public.daily_cash_snapshots
  ADD CONSTRAINT daily_cash_snapshots_user_id_account_id_date_key
  UNIQUE (user_id, account_id, date);

DROP INDEX IF EXISTS daily_cash_snapshots_user_date_idx;
CREATE INDEX IF NOT EXISTS daily_cash_snapshots_user_account_date_idx
  ON public.daily_cash_snapshots(user_id, account_id, date DESC);
