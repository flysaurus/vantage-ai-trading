-- ═══════════════════════════════════════════════════════════
-- Migration: 067_classifier_audit.sql
-- Purpose: Append-only audit log of every AI-advisor intent classification
--          (fast-path, gpt-5-nano, and fail-open). Lets us review routing
--          decisions over time to catch mislabels — e.g. a read-only query
--          ("what are my scheduled buys") mislabeled as portfolio_construction.
--
--          The LLM only LABELS; this table is how we eyeball the labels
--          without adding latency to the chat path (fire-and-forget insert).
--
-- Access: service-role ONLY. RLS disabled; ALL privs revoked from
--         anon/authenticated (same pattern as 066_pending_actions.sql).
--
-- Date: 2026-08-29
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.classifier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  message text,
  category text NOT NULL,
  source text NOT NULL
    CHECK (source IN ('fast_path', 'gpt5_nano', 'fail_open')),
  confidence numeric,
  vehicle text,
  needs_search boolean,
  search_query text,
  profile_field text,
  profile_value text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS classifier_audit_user_created_idx
  ON public.classifier_audit (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS classifier_audit_source_category_idx
  ON public.classifier_audit (source, category);

ALTER TABLE public.classifier_audit DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.classifier_audit FROM anon, authenticated;

COMMIT;
