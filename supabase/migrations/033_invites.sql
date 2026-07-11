-- Migration 033: Invite-only signup gate
-- Invites table + helper function. Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  invite_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_by TEXT NOT NULL,          -- admin email
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

-- Index for looking up invites by email
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.invites (email, status);

-- Index for validating tokens
CREATE INDEX IF NOT EXISTS idx_invites_token ON public.invites (invite_token);

-- Auto-expire: mark invites as expired if past expires_at
CREATE OR REPLACE FUNCTION expire_old_invites() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.invites
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$;

-- Function: validate an invite token — returns email if valid, null if not
CREATE OR REPLACE FUNCTION validate_invite_token(p_token TEXT)
RETURNS TABLE(invite_email TEXT, is_valid BOOLEAN) LANGUAGE plpgsql AS $$
BEGIN
  -- First, expire any stale invites
  PERFORM expire_old_invites();

  RETURN QUERY
  SELECT i.email::TEXT, true::BOOLEAN
  FROM public.invites i
  WHERE i.invite_token = p_token
    AND i.status = 'pending'
    AND i.expires_at > NOW()
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::TEXT, false::BOOLEAN;
  END IF;
END;
$$;
