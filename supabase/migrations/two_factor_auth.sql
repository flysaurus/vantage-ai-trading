-- two_factor_auth.sql — 2FA table for Vantage
-- Stores encrypted TOTP secrets + backup codes per user.

CREATE TABLE IF NOT EXISTS public.two_factor_auth (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  totp_secret_encrypted TEXT NOT NULL,
  backup_codes_encrypted TEXT,
  is_enabled         BOOLEAN DEFAULT false,
  verified_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS idx_two_factor_auth_user_id ON public.two_factor_auth(user_id);

-- Allow service_role access (already handled by service_role bypass)
ALTER TABLE public.two_factor_auth ENABLE ROW LEVEL SECURITY;
