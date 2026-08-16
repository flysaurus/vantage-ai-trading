-- ═══════════════════════════════════════════════════════════════
-- Migration: daily_briefs + weekly_snapshots account_id — account-scoped
--             brief/snapshot caching.
-- Run in: Supabase SQL Editor (idempotent)
-- Purpose: Briefs/snapshots are now generated per active account
--          (demo vs broker), so their cache must be scoped per account.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Add account_id to daily_briefs
ALTER TABLE public.daily_briefs
  ADD COLUMN IF NOT EXISTS account_id TEXT DEFAULT 'demo';

-- 2. Backfill existing daily briefs as demo (pre-isolation default account)
UPDATE public.daily_briefs SET account_id = 'demo' WHERE account_id IS NULL;

-- 3. Add account_id to weekly_snapshots
ALTER TABLE public.weekly_snapshots
  ADD COLUMN IF NOT EXISTS account_id TEXT DEFAULT 'demo';

-- 4. Backfill existing weekly snapshots as demo
UPDATE public.weekly_snapshots SET account_id = 'demo' WHERE account_id IS NULL;

-- 5. Replace the per-user unique constraint with a per-account one.
--    Drop the old (user_id, date)/(user_id, week_start) constraints so a
--    user can hold a distinct brief per account on the same day/week.
ALTER TABLE public.daily_briefs
  DROP CONSTRAINT IF EXISTS daily_briefs_user_id_date_key;

ALTER TABLE public.daily_briefs
  ADD CONSTRAINT daily_briefs_user_account_date_key
  UNIQUE (user_id, account_id, date);

ALTER TABLE public.weekly_snapshots
  DROP CONSTRAINT IF EXISTS weekly_snapshots_user_id_week_start_key;

ALTER TABLE public.weekly_snapshots
  ADD CONSTRAINT weekly_snapshots_user_account_week_key
  UNIQUE (user_id, account_id, week_start);

-- 6. Composite indexes for the hot per-account cache lookups
CREATE INDEX IF NOT EXISTS idx_daily_briefs_user_account
  ON public.daily_briefs(user_id, account_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_snapshots_user_account
  ON public.weekly_snapshots(user_id, account_id, week_start DESC);

COMMIT;
