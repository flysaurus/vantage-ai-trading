-- ============================================================
-- ANONYMOUS SESSIONS MIGRATION
-- ============================================================
-- Run in: Supabase Dashboard → SQL Editor
-- Adds tables for anonymous profiles and login streaks.
-- ============================================================

-- 1. Add anonymous_id column to all user-data tables
-- Uses a dynamic loop so missing tables are skipped gracefully.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'demo_portfolio_state',
      'chat_messages',
      'trade_history',
      'watchlists',
      'chat_history',
      'account_snapshots',
      'metrics',
      'strategies',
      'alerts',
      'ai_suggestions',
      'daily_suggestions',
      'scanner_recommendations',
      'recent_notifications'
    ])
  LOOP
    -- Skip if column already exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = tbl AND column_name = 'anonymous_id'
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I ADD COLUMN anonymous_id TEXT;', tbl);
      EXCEPTION
        WHEN undefined_table THEN NULL;
      END;
    END IF;
  END LOOP;
END;
$$;

-- 2. Add indexes (skips missing tables automatically with IF NOT EXISTS)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'demo_portfolio_state',
      'chat_messages',
      'trade_history',
      'watchlists'
    ])
  LOOP
    BEGIN
      EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_anon_id ON %I(anonymous_id);', tbl, tbl);
    EXCEPTION
      WHEN undefined_table THEN NULL;
    END;
  END LOOP;
END;
$$;

-- ============================================================
-- ANONYMOUS PROFILES TABLE
-- Stores profile data for anonymous sessions.
-- Uses anonymous_id as the unique key (no user_id yet).
-- After magic link auth, this data is migrated and the row
-- can be linked to a real user_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS anonymous_profiles (
  anonymous_id TEXT PRIMARY KEY,
  first_name TEXT,
  investor_style TEXT,
  risk_tolerance TEXT,
  first_open TIMESTAMPTZ,
  last_active TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anon_profiles_last_active 
  ON anonymous_profiles(last_active DESC);

-- ============================================================
-- STREAKS TABLE
-- Tracks daily login streaks for anonymous AND authenticated users.
-- One row per anonymous_id. Migrated to user_id after auth.
-- ============================================================

CREATE TABLE IF NOT EXISTS streaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  anonymous_id TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_open_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_days_active INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- One streak per anonymous_id (prevents duplicates)
  UNIQUE(anonymous_id),
  -- After auth, switch to user_id uniqueness
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_streaks_anon_id 
  ON streaks(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_streaks_user_id 
  ON streaks(user_id);

-- ============================================================
-- RLS: Enable on new tables
-- ============================================================

ALTER TABLE anonymous_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;

-- Anonymous profiles: service_role only (server-side access)
-- Streaks: service_role only (server-side access)

-- ============================================================
-- Update migrate_anonymous_data() to include new tables
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
      'demo_portfolio_state'
    ])
  LOOP
    BEGIN
      EXECUTE format(
        'UPDATE %I SET user_id = $1 WHERE user_id = $2',
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
