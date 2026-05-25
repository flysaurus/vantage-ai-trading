-- ============================================================
-- URGENT — Auto-populate public.users from auth.users
-- 
-- Run this ENTIRE script in the Supabase SQL Editor:
--   https://ixjnuoslbzytubpplkot.supabase.co
-- 
-- This fixes: "Sign in works but app is broken after login"
-- Root cause: auth.users has rows but public.users is empty
-- ============================================================

-- ── 1. Create the auto-sync trigger function ─────────────────
-- Runs automatically whenever a new user is inserted into auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ── 2. Create the trigger on auth.users ──────────────────────
-- Delete old trigger if it already exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Backfill existing auth users ──────────────────────────
-- Insert any auth users that don't yet have a public.users row
INSERT INTO public.users (id, email, display_name)
SELECT
  au.id,
  au.email,
  COALESCE(
    au.raw_user_meta_data->>'display_name',
    split_part(au.email, '@', 1)
  )
FROM auth.users AS au
LEFT JOIN public.users AS pu ON pu.id = au.id
WHERE pu.id IS NULL
AND au.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- ── 4. Verify ────────────────────────────────────────────────
SELECT
  'auth.users count' AS label,
  COUNT(*)::text AS value
FROM auth.users
WHERE deleted_at IS NULL

UNION ALL

SELECT
  'public.users count' AS label,
  COUNT(*)::text AS value
FROM public.users

UNION ALL

SELECT
  'orphans (auth but not public)' AS label,
  COUNT(*)::text AS value
FROM auth.users AS au
LEFT JOIN public.users AS pu ON pu.id = au.id
WHERE pu.id IS NULL
AND au.deleted_at IS NULL;
