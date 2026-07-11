-- ============================================================
-- Migration 031: Ensure all expected users columns exist
-- ============================================================
-- Production Supabase instances may have been created with only
-- the default Supabase Auth columns (id, email, created_at, etc.).
-- This migration adds every column the codebase queries, using
-- ADD COLUMN IF NOT EXISTS to be safe regardless of state.
--
-- This consolidates missing columns from schema.sql, various
-- migrations, and implicit additions. Safe to run repeatedly.
-- ============================================================

-- Identity / profile
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS investor_style TEXT DEFAULT 'buffett';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS investor_style_onboarded BOOLEAN DEFAULT FALSE;

-- Admin
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- Subscription / tier
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'demo';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tier_upgraded_at TIMESTAMPTZ;

-- Usage counters (migration 024)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS demo_deep_pool_used INTEGER DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_chat_used INTEGER DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS monthly_deep_used INTEGER DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ;

-- Timestamps
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill display_name from email
UPDATE public.users
  SET display_name = SPLIT_PART(email, '@', 1)
  WHERE display_name IS NULL AND email IS NOT NULL;

-- Backfill is_admin for the known admin (safe — only sets true on exact match)
UPDATE public.users
  SET is_admin = true
  WHERE LOWER(email) = 'mparikh01@gmail.com' AND is_admin = false;
