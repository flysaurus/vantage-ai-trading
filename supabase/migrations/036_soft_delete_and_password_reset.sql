-- ─── Soft Delete + Password Reset ───────────────────────────
-- Migration 036
-- Adds:
--   1. users.deleted — soft delete flag (default false)
--   2. password_resets table — admin-initiated password reset tokens
--
-- Run: Supabase Dashboard → SQL Editor → paste → Run

-- 1. Soft delete column
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS deleted BOOLEAN NOT NULL DEFAULT false;

-- 2. Password reset tokens table
CREATE TABLE IF NOT EXISTS public.password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  reset_token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  used_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,       -- admin email who initiated
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON public.password_resets (reset_token) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON public.password_resets (user_id);
