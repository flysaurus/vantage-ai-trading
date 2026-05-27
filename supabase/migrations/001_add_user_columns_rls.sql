-- Migration: Add API config columns, enforce user existence, enable RLS
-- Run in: Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)

BEGIN;

-- ─── Add Missing Columns ────────────────────────────────────

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS api_provider text DEFAULT 'alpaca';
ALTER TABLE public.users ADD CONSTRAINT valid_api_provider
  CHECK (api_provider IN ('alpaca', 'interactive_brokers', 'robinhood', 'schwab', 'etrade'));

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE public.users ADD CONSTRAINT valid_status
  CHECK (status IN ('active', 'inactive', 'suspended'));

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferences jsonb DEFAULT '{}';

-- Fix auth_provider default — new signups are email-based, not Google
ALTER TABLE public.users ALTER COLUMN auth_provider SET DEFAULT 'email';

-- Make email NOT NULL (no rows exist with null email, safe)
ALTER TABLE public.users ALTER COLUMN email SET NOT NULL;

-- ─── Indexes ────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON public.users(auth_provider);

-- ─── Row Level Security ─────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can only read their own row (RLS-enforced for anon/authenticated clients)
CREATE POLICY "Users can read own data" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON public.users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Policy: Users can insert their own row (for signup/create flow)
CREATE POLICY "Users can insert own row" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Service role bypasses RLS by default in Supabase, but explicit policy = self-documenting
CREATE POLICY "Service role can do everything" ON public.users
  USING (auth.role() = 'service_role');

COMMIT;

-- ─── Verify ─────────────────────────────────────────────────

\d public.users
