-- ============================================================
-- VANTAGE MAGIC LINK AUTH MIGRATION
-- ============================================================
-- Run in: Supabase Dashboard → SQL Editor
-- Adds anonymous_id column + data migration RPC function
-- ============================================================

-- 1. Add anonymous_id column to users table
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS anonymous_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_anonymous_id ON users(anonymous_id);

-- 2. Add anonymous_id to tables that may hold anonymous data
-- (user_id = anonymous_id for anonymous sessions)

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
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
      'recent_notifications'
    ])
  LOOP
    -- Skip if column already exists
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = tbl AND column_name = 'anonymous_id'
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN anonymous_id TEXT;', tbl);
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- RPC: migrate_anonymous_data
-- Moves all data from an anonymous ID to a real user ID.
-- Called after magic link sign-in to preserve anonymous session
-- data (chat history, trades, watchlists, portfolio state, etc.)
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
  -- Security: only allow migration if anonymous_id is non-empty
  -- and the target user exists
  IF p_anonymous_id IS NULL OR p_anonymous_id = '' THEN
    RAISE EXCEPTION 'Anonymous ID must not be empty';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user does not exist';
  END IF;

  -- Migrate each table that has a user_id column
  -- Using dynamic SQL to handle tables that may not exist

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
      'recent_notifications'
    ])
  LOOP
    BEGIN
      -- Update rows where user_id matches the anonymous_id
      EXECUTE format(
        'UPDATE %I SET user_id = $1 WHERE user_id = $2',
        v_table
      ) USING p_user_id, p_anonymous_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      
      IF v_count > 0 THEN
        v_result := jsonb_set(
          v_result,
          ARRAY[v_table],
          to_jsonb(v_count)
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        -- Table might not exist or might not have user_id column
        -- Log and continue
        v_result := jsonb_set(
          v_result,
          ARRAY[v_table],
          '"skipped"'::JSONB
        );
    END;
  END LOOP;

  -- Update user_profiles (users table) to link anonymous_id
  UPDATE users 
  SET anonymous_id = p_anonymous_id,
      updated_at = NOW()
  WHERE id = p_user_id;

  v_result := jsonb_set(v_result, ARRAY['profile_linked'], '"true"'::JSONB);

  RETURN v_result;
END;
$$;
