-- ============================================================
-- INVESTOR SCORE COLUMNS (011)
-- ============================================================
-- Run in: Supabase Dashboard → SQL Editor
-- Adds score_history, last_score, last_level columns to
-- the investor_scores table for weekly snapshots.
-- ============================================================

-- 1. Add score tracking columns to investor_scores
ALTER TABLE investor_scores
ADD COLUMN IF NOT EXISTS score_history JSONB DEFAULT '[]'::JSONB,
ADD COLUMN IF NOT EXISTS last_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_level TEXT DEFAULT 'Apprentice';

-- 2. Add index for cron queries (find all non-null anonymous_ids)
CREATE INDEX IF NOT EXISTS idx_investor_scores_anon_active
  ON investor_scores(anonymous_id, last_score DESC)
  WHERE anonymous_id IS NOT NULL;

-- 3. Add RLS policy for service_role access (already enabled)
-- No additional RLS needed — service_role bypasses RLS by default.
