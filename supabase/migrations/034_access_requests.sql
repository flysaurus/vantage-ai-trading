-- Migration 034: Access Requests (Waitlist)
-- Captures signup attempts from users without valid invites.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  auto_approve BOOLEAN NOT NULL DEFAULT false,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by TEXT,      -- admin email
  reviewed_at TIMESTAMPTZ
);

-- Prevent duplicate pending requests for same email
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_pending
  ON public.access_requests (email)
  WHERE status = 'pending';

-- Index for filtering by status
CREATE INDEX IF NOT EXISTS idx_access_requests_status
  ON public.access_requests (status, requested_at DESC);
