-- ============================================================
-- Migration 015: Add first_name / last_name to users table
-- ============================================================
-- Root cause fix: auth/complete route upserts with first_name
-- and last_name, but these columns never existed on users.
-- Every upsert silently failed, no user records were created.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '';
