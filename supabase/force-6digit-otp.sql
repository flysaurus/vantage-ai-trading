-- Force 6-digit OTP length
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Try the direct update first:
UPDATE auth.config
SET mailer_otp_length = 6
WHERE id = 1;

-- If that column doesn't exist, create it:
-- ALTER TABLE auth.config
-- ADD COLUMN IF NOT EXISTS mailer_otp_length INT DEFAULT 6;
-- UPDATE auth.config SET mailer_otp_length = 6;
