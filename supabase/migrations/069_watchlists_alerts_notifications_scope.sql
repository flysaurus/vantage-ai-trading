-- ─── 069_watchlists_alerts_notifications_scope ─────────────────────────────
-- Account-level data segregation for the remaining user-content tables:
--   watchlists, alerts, recent_notifications, rebalance_sessions,
--   pending_actions.
--
-- Previously these were scoped by user_id ONLY, so content created under one
-- account (e.g. the demo portfolio) could surface under another account of the
-- same user. This mirrors the orders/positions/strategies convention: a
-- `connection_id` (broker_connections.id) for live/paper accounts + an
-- `is_demo` flag for the demo portfolio.
--
-- pending_actions is transient (5-min TTL) and already carries the acting
-- `accountId` in its JSON payload; we add an explicit `account_id` column for
-- queryability/auditing only — the payload remains the execution source of truth.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. watchlists
ALTER TABLE public.watchlists
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;
ALTER TABLE public.watchlists
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- 2. alerts
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- 3. recent_notifications
ALTER TABLE public.recent_notifications
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;
ALTER TABLE public.recent_notifications
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- 4. rebalance_sessions
ALTER TABLE public.rebalance_sessions
  ADD COLUMN IF NOT EXISTS connection_id UUID
    REFERENCES public.broker_connections(id) ON DELETE SET NULL;
ALTER TABLE public.rebalance_sessions
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- 5. pending_actions (audit/queryability only; payload is source of truth)
ALTER TABLE public.pending_actions
  ADD COLUMN IF NOT EXISTS account_id text;

-- 6. Backfill legacy rows to the user's sole connected snap-trade broker.
--    All pre-existing rows were user-level (no demo path existed for these),
--    so treat them as live and attach the user's oldest connected broker.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['watchlists','alerts','recent_notifications','rebalance_sessions'] LOOP
    EXECUTE format(
      'UPDATE public.%I t
         SET connection_id = (
           SELECT bc.id FROM public.broker_connections bc
            WHERE bc.user_id = t.user_id
              AND bc.connection_type = ''snaptrade''
              AND bc.status = ''connected''
            ORDER BY bc.created_at ASC LIMIT 1
         )
       WHERE t.is_demo = false AND t.connection_id IS NULL', t);
  END LOOP;
END $$;

-- 7. Indexes for the common scope lookups.
CREATE INDEX IF NOT EXISTS idx_watchlists_user_connection
  ON public.watchlists(user_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_user_demo
  ON public.watchlists(user_id) WHERE is_demo = true;

CREATE INDEX IF NOT EXISTS idx_alerts_user_connection
  ON public.alerts(user_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user_demo
  ON public.alerts(user_id) WHERE is_demo = true;

CREATE INDEX IF NOT EXISTS idx_notifications_user_connection
  ON public.recent_notifications(user_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_demo
  ON public.recent_notifications(user_id) WHERE is_demo = true;

CREATE INDEX IF NOT EXISTS idx_rebalance_sessions_user_connection
  ON public.rebalance_sessions(user_id, connection_id);
CREATE INDEX IF NOT EXISTS idx_rebalance_sessions_user_demo
  ON public.rebalance_sessions(user_id) WHERE is_demo = true;

COMMIT;
