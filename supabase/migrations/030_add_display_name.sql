-- ============================================================
-- Migration 030: Add missing display_name column to users
-- ============================================================
-- The schema.sql defines display_name but some Supabase instances
-- were created before it was applied. This migration adds it
-- unconditionally and backfills from email where possible.
-- ============================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Backfill display_name from email username for users without one
UPDATE public.users
  SET display_name = SPLIT_PART(email, '@', 1)
  WHERE display_name IS NULL
    AND email IS NOT NULL;
