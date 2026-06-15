-- ============================================================
-- GAMIFICATION MIGRATION (010)
-- ============================================================
-- Run in: Supabase Dashboard → SQL Editor
-- Adds milestones and investor_scores tables for gamification.
-- ============================================================

-- ============================================================
-- MILESTONES TABLE
-- Tracks achievements unlocked by anonymous AND authenticated
-- users. One row per (anonymous_id, milestone_key) pair.
-- ============================================================

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  milestone_key TEXT NOT NULL,
  milestone_label TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  awarded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- One award per anonymous_id per milestone
  UNIQUE(anonymous_id, milestone_key),
  -- After auth, switch to user_id
  UNIQUE(user_id, milestone_key)
);

CREATE INDEX IF NOT EXISTS idx_milestones_anon_id 
  ON milestones(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_milestones_user_id 
  ON milestones(user_id);
CREATE INDEX IF NOT EXISTS idx_milestones_key 
  ON milestones(milestone_key);

-- ============================================================
-- INVESTOR_SCORES TABLE
-- Tracks gamification scores and activity counts for
-- anonymous AND authenticated users.
-- ============================================================

-- If table exists from a prior partial run, ensure all columns exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'investor_scores') THEN
    ALTER TABLE investor_scores
      ADD COLUMN IF NOT EXISTS baskets_created INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS trades_executed INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS ai_sessions INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS milestones_earned INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS total_score INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS style_consistency INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS streak_bonus INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW();
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS investor_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Activity counters
  baskets_created INTEGER NOT NULL DEFAULT 0,
  trades_executed INTEGER NOT NULL DEFAULT 0,
  ai_sessions INTEGER NOT NULL DEFAULT 0,
  milestones_earned INTEGER NOT NULL DEFAULT 0,
  
  -- Scoring
  total_score INTEGER NOT NULL DEFAULT 0,
  style_consistency INTEGER NOT NULL DEFAULT 0,
  streak_bonus INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(anonymous_id),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_investor_scores_anon_id 
  ON investor_scores(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_investor_scores_user_id 
  ON investor_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_investor_scores_total 
  ON investor_scores(total_score DESC);

-- ============================================================
-- RLS: Enable on new tables
-- ============================================================

ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_scores ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Add to migrate_anonymous_data() RPC
-- ============================================================

CREATE OR REPLACE FUNCTION migrate_anonymous_data(
  p_anonymous_id TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB := '{}'::JSONB;
  v_count INTEGER;
  v_table TEXT;
BEGIN
  -- Security checks
  IF p_anonymous_id IS NULL OR p_anonymous_id = '' THEN
    RAISE EXCEPTION 'Anonymous ID must not be empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  -- Migrate each table with user_id column
  FOR v_table IN
    SELECT unnest(ARRAY[
      'chat_history',
      'chat_messages',
      'trade_history',
      'watchlists',
      'account_snapshots',
      'metrics',
      'portfolio_analysis',
      'strategies',
      'alerts',
      'ai_suggestions',
      'daily_suggestions',
      'scanner_recommendations',
      'recent_notifications',
      'demo_portfolio_state',
      'milestones',
      'investor_scores'
    ])
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE %I SET user_id = $1 WHERE user_id IS NULL AND anonymous_id = $2',
        v_table
      ) USING p_user_id, p_anonymous_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      
      IF v_count > 0 THEN
        v_result := jsonb_set(v_result, ARRAY[v_table], to_jsonb(v_count));
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        v_result := jsonb_set(v_result, ARRAY[v_table], '"skipped"'::JSONB);
    END;
  END LOOP;

  -- Migrate anonymous profile to users table
  UPDATE users u
  SET 
    display_name = COALESCE(ap.first_name, u.display_name),
    investor_style = COALESCE(ap.investor_style::TEXT, u.investor_style),
    anonymous_id = p_anonymous_id,
    updated_at = NOW()
  FROM anonymous_profiles ap
  WHERE u.id = p_user_id
    AND ap.anonymous_id = p_anonymous_id;

  v_result := jsonb_set(v_result, ARRAY['profile_merged'], '"true"'::JSONB);

  -- Migrate streak to user_id
  EXECUTE format(
    'UPDATE streaks SET user_id = $1 WHERE anonymous_id = $2 AND user_id IS NULL'
  ) USING p_user_id, p_anonymous_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := jsonb_set(v_result, ARRAY['streaks'], to_jsonb(COALESCE(v_count, 0)));

  -- Clean up anonymous profile row (data is now in users table)
  DELETE FROM anonymous_profiles WHERE anonymous_id = p_anonymous_id;

  v_result := jsonb_set(v_result, ARRAY['migration_complete'], '"true"'::JSONB);

  RETURN v_result;
END;
$$;
