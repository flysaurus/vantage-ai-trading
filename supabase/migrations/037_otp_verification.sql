-- ─── Migration 037: OTP Email Verification ──────────────────────
-- Adds OTP columns to users table for email verification flow.
--
-- Flow:
--  1. User signs up → OTP generated, stored, emailed
--  2. User clicks email link or enters code manually
--  3. Code validated → email_verified set to true
--  4. Resend generates new code, reset attempts counter
--  5. After 5 wrong attempts → locked out, must resend
--  6. User can log in before verifying (soft gate)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wrong_otp_attempts INTEGER NOT NULL DEFAULT 0;

-- Backfill existing users: mark admin accounts as verified
UPDATE public.users
  SET email_verified = true
  WHERE is_admin = true AND email_verified = false;
