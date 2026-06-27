-- ═══════════════════════════════════════════════════
-- Migration: Broker connections infrastructure
-- Purpose: Add connection tracking to users table +
--          create broker_connections table with RLS
-- Date: 2026-06-28
-- ═══════════════════════════════════════════════════

-- ── STEP 1: ALTER public.users ──────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS connection_type VARCHAR
    CHECK (connection_type IN ('snaptrade','alpaca','tastytrade'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS connection_status VARCHAR
    CHECK (connection_status IN ('pending','syncing','connected','failed'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS connection_initiated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tier_upgraded_at TIMESTAMPTZ DEFAULT NULL;

-- ── STEP 2: CREATE public.broker_connections ────

CREATE TABLE IF NOT EXISTS public.broker_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  connection_type VARCHAR NOT NULL CHECK (connection_type IN ('snaptrade','alpaca','tastytrade')),
  encrypted_api_key TEXT DEFAULT NULL,
  encrypted_secret TEXT DEFAULT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','syncing','connected','failed')),
  sync_started_at TIMESTAMPTZ DEFAULT NULL,
  sync_completed_at TIMESTAMPTZ DEFAULT NULL,
  error_message TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── STEP 3: RLS ON broker_connections ───────────

ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own connections"
  ON public.broker_connections FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own connections"
  ON public.broker_connections FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own connections"
  ON public.broker_connections FOR UPDATE
  USING (user_id = auth.uid());

-- ── STEP 4: UPDATED_AT TRIGGER ──────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER broker_connections_updated_at
  BEFORE UPDATE ON public.broker_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── STEP 5: INDEX for performance ────────────────

CREATE INDEX IF NOT EXISTS idx_broker_connections_user_id
  ON public.broker_connections(user_id);

CREATE INDEX IF NOT EXISTS idx_broker_connections_status
  ON public.broker_connections(status);
