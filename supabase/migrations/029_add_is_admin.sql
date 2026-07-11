-- ============================================================
-- Migration 029: DB-backed is_admin flag
-- ============================================================
-- Replaces the hardcoded ADMIN_EMAILS env var as the primary
-- admin check. ADMIN_EMAILS remains as a transitional fallback
-- in case the DB query has a bug — we don't want to lock
-- out all admin access during migration.
--
-- Future: /admin/users can grant/revoke is_admin per-user,
-- with each change audit-logged to admin_audit_log.
-- ============================================================

-- 1. Add is_admin column
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Bootstrap: set is_admin = true for the existing admin
-- Uses email matching since this is the same allowlist
-- ADMIN_EMAILS uses. Safe — only sets true on exact match.
UPDATE public.users
  SET is_admin = true
  WHERE LOWER(email) = 'mparikh01@gmail.com'
    AND is_admin = false;

-- 3. Index for fast is_admin lookups
CREATE INDEX IF NOT EXISTS idx_users_is_admin
  ON public.users(is_admin)
  WHERE is_admin = true;

-- 4. Comment for documentation
COMMENT ON COLUMN public.users.is_admin IS
  'Whether the user has admin access. Primary admin gate — supersedes ADMIN_EMAILS env var.';
