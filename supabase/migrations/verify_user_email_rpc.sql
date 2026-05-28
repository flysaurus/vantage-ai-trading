-- ─── verify_user_email_now (fixed) ─────────────────────────────
-- Removed SET search_path = '' — was possibly blocking NOW()
-- SECURITY DEFINER still applies, but NOW() and public.users resolve fine

CREATE OR REPLACE FUNCTION verify_user_email_now(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET email_verified = TRUE, email_verified_at = NOW(), updated_at = NOW()
  WHERE id = p_user_id;
  RETURN FOUND;
END;
$$;

-- Test it immediately on your current user:
-- Replace the UUID below with the one you just created
SELECT verify_user_email_now('6e51e4a2-e3f4-4092-96ea-dd5622fa2a33') AS result;

-- Then verify:
SELECT id, email_verified, email_verified_at FROM public.users WHERE id = '6e51e4a2-e3f4-4092-96ea-dd5622fa2a33';
