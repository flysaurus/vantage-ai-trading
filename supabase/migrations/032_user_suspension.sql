-- Migration 032: User suspension flag
-- Adds suspended column for soft-deactivation (preserves all data).
-- Also ensures is_admin column exists for admin grant/revoke.
-- Run in Supabase SQL Editor.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS suspended BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;

-- Index for quick suspension checks at auth time
CREATE INDEX IF NOT EXISTS idx_users_suspended ON public.users (suspended);
CREATE INDEX IF NOT EXISTS idx_users_is_admin ON public.users (is_admin);
