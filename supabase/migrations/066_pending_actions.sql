-- ═══════════════════════════════════════════════════════════
-- Migration: 066_pending_actions.sql
-- Purpose: Short-lived "pending action" tickets for the AI-advisor
--          plan-then-confirm gate. Money tools (DCA create/edit/cancel,
--          watchlist add/remove, alert create/edit/cancel, single trade,
--          basket execute, rebalance) are PREVIEW-ONLY: they validate and
--          store a pending_action ticket here, but never execute a side
--          effect. A separate DETERMINISTIC confirm step (never the LLM)
--          looks up the ticket and runs the real endpoint.
--
-- Design invariants:
--   - ~5 min TTL (expires_at) — stale previews can't be confirmed.
--   - ONE outstanding pending action per user (partial unique index on
--     status='pending') — a new preview supersedes the old one.
--   - status transitions: pending → executed | cancelled | expired.
--   - idempotency_key lets the confirm step dedupe double-taps.
--
-- Access: service-role ONLY. RLS disabled (auth enforced in the chat route
-- via requireAuth → userId) and ALL privileges revoked from anon/authenticated
-- (Supabase grants table-level SELECT to client roles by default — see 065).
--
-- Date: 2026-08-28
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT '',
  amount_usd numeric,
  confirm_token text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'executed', 'cancelled', 'expired')),
  idempotency_key text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  executed_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS pending_actions_user_idx
  ON public.pending_actions (user_id, status);

-- Enforce at most ONE outstanding (pending) action per user.
CREATE UNIQUE INDEX IF NOT EXISTS pending_actions_one_pending_per_user
  ON public.pending_actions (user_id)
  WHERE status = 'pending';

-- Auth enforced in the chat route; only service_role should touch this table.
ALTER TABLE public.pending_actions DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pending_actions FROM anon, authenticated;

COMMIT;
