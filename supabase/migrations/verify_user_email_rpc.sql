-- ─── verify_user_email RPC ────────────────────────────────────
-- Run in Supabase Dashboard → SQL Editor
-- Used by authVerifyEmail as last-resort update strategy

CREATE OR REPLACE FUNCTION verify_user_email(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.users
  SET
    email_verified = TRUE,
    email_verified_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id;

  GET DIAGNOSTICS affected = ROW_COUNT;

  IF affected > 0 THEN
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;
