-- ============================================================
-- FIX: "Database error creating new user"
-- Root cause: trigger on_auth_user_created fires AFTER INSERT
-- on auth.users, calls handle_new_user() which does
-- INSERT INTO public.users — but public.users table doesn't exist.
-- This kills auth.admin.createUser() with "Database error".
--
-- Fix: Drop the trigger. user_profiles is now managed explicitly
-- by createAccount (email/password) and /auth/complete (OAuth).
-- The trigger is redundant and broken.
--
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- Verify it's gone
SELECT trigger_name
FROM information_schema.triggers
WHERE event_object_table = 'users'
  AND event_object_schema = 'auth';

-- Should return 0 rows
