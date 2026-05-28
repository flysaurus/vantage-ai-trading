-- ─── verify_user_email_now ────────────────────────────────────
-- Run in Supabase Dashboard → SQL Editor
-- Used by authVerifyEmail to update email_verified ON public.users
-- SECURITY DEFINER + set search_path = '' ensures it runs with
-- creator's privileges and is immune to search_path attacks.

CREATE OR REPLACE FUNCTION verify_user_email_now(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.users
  SET
    email_verified = TRUE,
    email_verified_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN FOUND;
END;
$$;

-- Grant execute to allow service_role access
GRANT EXECUTE ON FUNCTION verify_user_email_now(UUID) TO service_role;
