-- ─── Migration 038: MFA / 2FA (TOTP + Email OTP) ─────────
-- Enables mandatory 2FA setup after email verification.
--
-- Flow:
--  1. Email verified → forced MFA setup → TOTP or Email OTP
--  2. TOTP: speakeasy secret + QR → verify → 8 backup codes (hashed)
--  3. Email OTP: reuses otp_code/otp_expires_at columns (037)
--  4. Login: password → MFA step → TOTP code, email OTP, or backup code
--  5. Recovery: backup codes (TOTP) or admin reset

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mfa_method VARCHAR(10),         -- 'totp' or 'email'
  ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(128),       -- speakeasy secret (encrypted at rest)
  ADD COLUMN IF NOT EXISTS backup_codes JSONB,             -- [{hash:string, used:bool}, ...]
  ADD COLUMN IF NOT EXISTS wrong_mfa_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mfa_locked_until TIMESTAMPTZ;

-- Add index for MFA lookups (rare but cheap)
CREATE INDEX IF NOT EXISTS idx_users_mfa_enabled ON public.users (mfa_enabled) WHERE mfa_enabled = true;
