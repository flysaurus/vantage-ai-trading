-- Migration 028: Admin Audit Log
-- Records every administrative action (tier overrides, flag changes, etc.)
-- for full accountability and rollback capability.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  target_user_id UUID NOT NULL,
  action TEXT NOT NULL,                -- 'tier_override', 'admin_flag_set', etc.
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying audit history per user
CREATE INDEX IF NOT EXISTS idx_admin_audit_target_user
  ON public.admin_audit_log (target_user_id);

-- Index for querying audit history per admin
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_email
  ON public.admin_audit_log (admin_email);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at
  ON public.admin_audit_log (created_at DESC);
