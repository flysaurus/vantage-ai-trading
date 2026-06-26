-- ============================================================
-- USER PROFILES TABLE FIX
-- ============================================================
-- The table exists but is missing columns. Adds what the
-- auth callback + janitor query expect.
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add missing columns (safe — skips if they already exist)
ALTER TABLE user_profiles 
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS anonymous_id TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Make user_id the unique key (the onConflict target)
-- Drop existing PK if it's on something else (like 'id')
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE table_name = 'user_profiles' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_pkey;
  END IF;
END;
$$;

-- Add unique constraint on user_id
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_user_id_unique UNIQUE (user_id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_anonymous_id 
  ON user_profiles(anonymous_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_created_at 
  ON user_profiles(created_at);

-- 4. Safe cleanup (the janitor query, now working)
DELETE FROM user_profiles 
WHERE created_at < NOW() - INTERVAL '1 hour' 
   OR user_id IS NULL;
