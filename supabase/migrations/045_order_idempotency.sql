-- ─────────────────────────────────────────────────────────────────────────────
-- 045_order_idempotency.sql
-- Server-side idempotency guard for real order placement.
--
-- Prevents duplicate REAL orders from double-taps or retries of the same AI
-- recommendation (message_id) or rapid manual re-submissions. The execute-trade
-- route reserves a dedup_key BEFORE placing an order; a second concurrent POST
-- for the same key is rejected ("This order was already submitted").
--
-- Access model: SERVICE-ROLE ONLY. The execute-trade route writes/reads this
-- table via the Supabase service key (which bypasses RLS). RLS is enabled with
-- no user policies — no client ever reads this table directly, and user_id /
-- message_id in dedup_key stay private.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.order_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dedup_key TEXT NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_idempotency_user
  ON public.order_idempotency(user_id);

ALTER TABLE public.order_idempotency ENABLE ROW LEVEL SECURITY;
