-- =============================================
-- VANTAGE AUTH REBUILD — PROMPT 1 OF 8
-- DATABASE CLEANUP & SCHEMA RESET
-- Run in Supabase SQL Editor
-- =============================================

-- =============================================
-- STEP 1 — AUDIT CURRENT STATE
-- =============================================

-- What tables exist right now?
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- What constraints exist?
SELECT
 tc.table_name,
 tc.constraint_name,
 tc.constraint_type,
 kcu.column_name,
 ccu.table_name AS references_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
 ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
 ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name;

-- What does user_profiles look like?
SELECT column_name, data_type, is_nullable,
 column_default
FROM information_schema.columns
WHERE table_name = 'user_profiles'
ORDER BY ordinal_position;

-- =============================================
-- STEP 2 — DROP LEGACY TABLES
-- =============================================

DROP TABLE IF EXISTS chat_history CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS login_attempts CASCADE;
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS password_resets CASCADE;

-- =============================================
-- STEP 3 — CLEAN TEST DATA
-- =============================================

-- Clean orphaned anonymous profiles
DELETE FROM user_profiles
WHERE user_id IS NULL;

-- Clean orphaned streaks
DELETE FROM streaks
WHERE user_id IS NULL;

-- Clean orphaned investor scores
DELETE FROM investor_scores
WHERE user_id IS NULL;

-- Clean orphaned milestones
DELETE FROM milestones
WHERE user_id IS NULL;

-- Clean orphaned pending orders
DELETE FROM pending_basket_orders
WHERE user_id IS NULL;

-- Clean orphaned chat messages
DELETE FROM chat_messages
WHERE user_id IS NULL;

-- Clean demo portfolio orphans
DELETE FROM demo_portfolio_state
WHERE user_id IS NULL;

-- =============================================
-- STEP 4 — REBUILD USER_PROFILES SCHEMA
-- =============================================

DROP TABLE IF EXISTS user_profiles CASCADE;

CREATE TABLE user_profiles (
 id uuid PRIMARY KEY
 REFERENCES auth.users(id)
 ON DELETE CASCADE,
 first_name text NOT NULL,
 last_name text NOT NULL,
 investor_style text CHECK (
 investor_style IN (
 'buffett','lynch','livermore',
 'munger','soros'
 )
 ),
 risk_tolerance text CHECK (
 risk_tolerance IN (
 'conservative','moderate','aggressive'
 )
 ),
 tier text NOT NULL DEFAULT 'demo'
 CHECK (tier IN ('demo','silver','gold')),
 first_open timestamptz NOT NULL
 DEFAULT now(),
 demo_expires_at timestamptz NOT NULL
 DEFAULT (now() + INTERVAL '30 days'),
 mfa_enrollment boolean NOT NULL
 DEFAULT false,
 created_at timestamptz NOT NULL
 DEFAULT now(),
 updated_at timestamptz NOT NULL
 DEFAULT now()
);

-- =============================================
-- STEP 5 — REMOVE ANONYMOUS_ID FROM ALL TABLES
-- =============================================

ALTER TABLE streaks
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE investor_scores
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE milestones
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE pending_basket_orders
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE chat_messages
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE demo_portfolio_state
 DROP COLUMN IF EXISTS anonymous_id;
ALTER TABLE daily_message_counts
 DROP COLUMN IF EXISTS anonymous_id;

-- =============================================
-- STEP 6 — REBUILD SUPPORTING TABLES
-- =============================================

-- STREAKS
DROP TABLE IF EXISTS streaks CASCADE;
CREATE TABLE streaks (
 id uuid PRIMARY KEY
 DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE
 REFERENCES auth.users(id)
 ON DELETE CASCADE,
 current_streak int NOT NULL DEFAULT 0,
 longest_streak int NOT NULL DEFAULT 0,
 last_open_date date,
 total_days int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL
 DEFAULT now(),
 updated_at timestamptz NOT NULL
 DEFAULT now()
);

-- INVESTOR_SCORES
DROP TABLE IF EXISTS investor_scores CASCADE;
CREATE TABLE investor_scores (
 id uuid PRIMARY KEY
 DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE
 REFERENCES auth.users(id)
 ON DELETE CASCADE,
 current_score int NOT NULL DEFAULT 0,
 current_level text NOT NULL
 DEFAULT 'Apprentice',
 baskets_created int NOT NULL DEFAULT 0,
 trades_executed int NOT NULL DEFAULT 0,
 ai_sessions int NOT NULL DEFAULT 0,
 style_consistency numeric(5,2) DEFAULT 0,
 risk_adherence numeric(5,2) DEFAULT 0,
 score_history jsonb NOT NULL DEFAULT '[]',
 updated_at timestamptz NOT NULL
 DEFAULT now()
);

-- MILESTONES
DROP TABLE IF EXISTS milestones CASCADE;
CREATE TABLE milestones (
 id uuid PRIMARY KEY
 DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL
 REFERENCES auth.users(id)
 ON DELETE CASCADE,
 milestone_key text NOT NULL,
 milestone_label text NOT NULL,
 achieved_at timestamptz NOT NULL
 DEFAULT now(),
 UNIQUE(user_id, milestone_key)
);

-- =============================================
-- STEP 7 — ROW LEVEL SECURITY
-- =============================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE investor_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_basket_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_portfolio_state ENABLE ROW LEVEL SECURITY;

-- user_profiles policies
CREATE POLICY "user_profiles_select"
 ON user_profiles FOR SELECT
 USING (auth.uid() = id);

CREATE POLICY "user_profiles_insert"
 ON user_profiles FOR INSERT
 WITH CHECK (auth.uid() = id);

CREATE POLICY "user_profiles_update"
 ON user_profiles FOR UPDATE
 USING (auth.uid() = id);

CREATE POLICY "service_role_all_profiles"
 ON user_profiles FOR ALL
 USING (auth.role() = 'service_role');

-- streaks policies
CREATE POLICY "streaks_select"
 ON streaks FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "streaks_insert"
 ON streaks FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "streaks_update"
 ON streaks FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "streaks_delete"
 ON streaks FOR DELETE
 USING (auth.uid() = user_id);

-- investor_scores policies
CREATE POLICY "investor_scores_select"
 ON investor_scores FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "investor_scores_insert"
 ON investor_scores FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "investor_scores_update"
 ON investor_scores FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "investor_scores_delete"
 ON investor_scores FOR DELETE
 USING (auth.uid() = user_id);

-- milestones policies
CREATE POLICY "milestones_select"
 ON milestones FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "milestones_insert"
 ON milestones FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "milestones_update"
 ON milestones FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "milestones_delete"
 ON milestones FOR DELETE
 USING (auth.uid() = user_id);

-- pending_basket_orders policies
CREATE POLICY "basket_orders_select"
 ON pending_basket_orders FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "basket_orders_insert"
 ON pending_basket_orders FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "basket_orders_update"
 ON pending_basket_orders FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "basket_orders_delete"
 ON pending_basket_orders FOR DELETE
 USING (auth.uid() = user_id);

-- chat_messages policies
CREATE POLICY "chat_messages_select"
 ON chat_messages FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "chat_messages_insert"
 ON chat_messages FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_messages_update"
 ON chat_messages FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "chat_messages_delete"
 ON chat_messages FOR DELETE
 USING (auth.uid() = user_id);

-- demo_portfolio_state policies
CREATE POLICY "demo_portfolio_select"
 ON demo_portfolio_state FOR SELECT
 USING (auth.uid() = user_id);

CREATE POLICY "demo_portfolio_insert"
 ON demo_portfolio_state FOR INSERT
 WITH CHECK (auth.uid() = user_id);

CREATE POLICY "demo_portfolio_update"
 ON demo_portfolio_state FOR UPDATE
 USING (auth.uid() = user_id);

CREATE POLICY "demo_portfolio_delete"
 ON demo_portfolio_state FOR DELETE
 USING (auth.uid() = user_id);

-- =============================================
-- STEP 8 — UPDATED_AT TRIGGER
-- =============================================

CREATE OR REPLACE FUNCTION
 update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
 NEW.updated_at = now();
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_profiles_at
 BEFORE UPDATE ON user_profiles
 FOR EACH ROW EXECUTE FUNCTION
 update_updated_at();

CREATE TRIGGER update_streaks_at
 BEFORE UPDATE ON streaks
 FOR EACH ROW EXECUTE FUNCTION
 update_updated_at();

CREATE TRIGGER update_investor_scores_at
 BEFORE UPDATE ON investor_scores
 FOR EACH ROW EXECUTE FUNCTION
 update_updated_at();

-- =============================================
-- STEP 9 — FINAL AUDIT (VERIFY STATE)
-- =============================================

-- Confirm only expected tables remain
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- Confirm user_profiles schema
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_profiles'
ORDER BY ordinal_position;

-- Confirm RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
