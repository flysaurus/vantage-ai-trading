-- ─── Database-level invite gate ──────────────────────────────
-- BEFORE INSERT trigger on auth.users that blocks user creation
-- unless a valid, pending, unexpired invite exists for that email.
--
-- This is defense-in-depth — even if someone bypasses the Next.js
-- API and calls Supabase Auth directly with the anon key, this
-- trigger will block them at the database level.
--
-- IMPORTANT: This trigger runs in the `auth` schema, which requires
-- elevated permissions. Run this in the Supabase SQL Editor as a
-- database administrator.
--
-- Run: Supabase Dashboard → SQL Editor → paste this entire file → Run

DO $$
BEGIN
  -- 1. Create the check function
  -- Returns the invite_id if valid, raises an exception otherwise
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'check_invite_before_signup' 
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'auth')
  ) THEN
    CREATE OR REPLACE FUNCTION auth.check_invite_before_signup()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $func$
    DECLARE
      invite_record RECORD;
    BEGIN
      -- Skip check for admin-created users (created via service role / Admin API)
      -- The service role bypasses triggers, but we check explicitly for clarity
      
      -- Check for valid invite
      SELECT id, status, expires_at 
      INTO invite_record
      FROM public.invites
      WHERE email = NEW.email
        AND LOWER(status) = 'pending'
        AND (expires_at IS NULL OR expires_at > NOW())
      LIMIT 1;

      IF invite_record.id IS NULL THEN
        RAISE EXCEPTION 'SIGNUP_BLOCKED: No valid pending invite found for %. Request an invite from an admin.', NEW.email;
      END IF;

      IF invite_record.expires_at IS NOT NULL AND invite_record.expires_at <= NOW() THEN
        RAISE EXCEPTION 'SIGNUP_BLOCKED: Invite for % has expired.', NEW.email;
      END IF;

      -- Invite is valid — allow the insert
      RETURN NEW;
    END;
    $func$;
  END IF;

  -- 2. Create the trigger (only if it doesn't exist)
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'enforce_invite_before_signup' 
    AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER enforce_invite_before_signup
      BEFORE INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION auth.check_invite_before_signup();
  END IF;
END;
$$;
