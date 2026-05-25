-- ============================================================
-- VANTAGE — AI-First Trading Platform
-- Supabase Schema v1.0
-- ============================================================
-- Run this in the Supabase SQL Editor:
--   https://ixjnuoslbzytubpplkot.supabase.co
--
-- Prerequisites (already installed):
--   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--   CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- ============================================================

-- ── Users ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Investor Style (add columns if missing) ──────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS investor_style TEXT DEFAULT 'buffett';
ALTER TABLE users ADD COLUMN IF NOT EXISTS investor_style_set_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS investor_style_onboarded BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_investor_style'
  ) THEN
    ALTER TABLE users
    ADD CONSTRAINT valid_investor_style
    CHECK (investor_style IN ('buffett', 'lynch', 'livermore', 'soros', 'munger'));
  END IF;
END;
$$;

-- ── Vault (encrypted Alpaca keys) ────────────────────────────
CREATE TABLE IF NOT EXISTS vault (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  encrypted_api_key TEXT NOT NULL,
  encrypted_secret_key TEXT NOT NULL,
  master_password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Chat History ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_user_created ON chat_history(user_id, created_at DESC);

-- ── Trade History ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alpaca_order_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  type TEXT NOT NULL DEFAULT 'market',
  qty NUMERIC NOT NULL,
  filled_price NUMERIC,
  total_value NUMERIC,
  status TEXT NOT NULL DEFAULT 'pending',
  bracket JSONB,
  ai_suggestion_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ
);

CREATE INDEX idx_trades_user ON trade_history(user_id, created_at DESC);
CREATE INDEX idx_trades_symbol ON trade_history(symbol);

-- ── AI Suggestions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell', 'hold', 'rebalance', 'insight')),
  symbol TEXT,
  conviction INTEGER CHECK (conviction >= 0 AND conviction <= 100),
  title TEXT NOT NULL,
  reason TEXT,
  metrics JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
  executed_trade_id UUID REFERENCES trade_history(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX idx_suggestions_user ON ai_suggestions(user_id, created_at DESC);

-- ── Alerts ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('price_above', 'price_below', 'volume_spike', 'technical')),
  threshold NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_user ON alerts(user_id, is_active);

-- ── Account Snapshots ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  equity NUMERIC NOT NULL DEFAULT 0,
  cash NUMERIC NOT NULL DEFAULT 0,
  buying_power NUMERIC NOT NULL DEFAULT 0,
  day_pnl NUMERIC NOT NULL DEFAULT 0,
  total_pnl NUMERIC NOT NULL DEFAULT 0,
  positions JSONB NOT NULL DEFAULT '[]',
  confidence_score INTEGER,
  snapshot_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_at)
);

CREATE INDEX idx_snapshots_user ON account_snapshots(user_id, snapshot_at DESC);

-- ── Watchlists ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  symbols JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_watchlists_user ON watchlists(user_id);

-- ── Market Cache (reduces API calls) ─────────────────────────
CREATE TABLE IF NOT EXISTS market_cache (
  symbol TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- ── Portfolio Analysis (cached style-based analysis) ─────────

CREATE TABLE IF NOT EXISTS portfolio_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Basic portfolio metrics
  total_value DECIMAL(15,2),
  total_gain DECIMAL(15,2),
  total_return DECIMAL(10,4),
  position_count INTEGER,

  -- Current selected style's analysis
  selected_style TEXT NOT NULL
    CHECK (selected_style IN ('buffett', 'lynch', 'livermore', 'soros', 'munger')),
  style_score INTEGER CHECK (style_score >= 0 AND style_score <= 100),
  style_recommendation TEXT
    CHECK (style_recommendation IN ('BUY_MORE', 'HOLD', 'SELL', 'REBALANCE')),
  style_insights TEXT[] DEFAULT '{}',

  -- Style conflict detection
  has_conflict BOOLEAN DEFAULT FALSE,
  conflict_severity TEXT
    CHECK (conflict_severity IN ('low', 'medium', 'high')),
  conflict_alert TEXT,

  -- All 5 styles comparison
  all_styles_recommendation JSONB DEFAULT '{
    "buffett": null,
    "lynch": null,
    "livermore": null,
    "soros": null,
    "munger": null
  }'::jsonb,

  -- Position-level recommendations — keyed by symbol
  -- {"AAPL":{"buffett":{"action":"HOLD","confidence":0.8,"reason":"..."},...},...}
  position_recommendations JSONB,

  -- Metadata
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  cached_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pa_user_id
  ON portfolio_analysis(user_id, analyzed_at DESC);

-- ============================================================
-- VAULT RPC FUNCTIONS (pgcrypto)
-- ============================================================

CREATE OR REPLACE FUNCTION vault_store_keys(
  p_user_id UUID,
  p_api_key TEXT,
  p_secret_key TEXT,
  p_master_hash TEXT,
  p_encryption_key TEXT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO vault (user_id, encrypted_api_key, encrypted_secret_key, master_password_hash)
  VALUES (
    p_user_id,
    extensions.pgp_sym_encrypt(p_api_key, p_encryption_key),
    extensions.pgp_sym_encrypt(p_secret_key, p_encryption_key),
    p_master_hash
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    encrypted_api_key = EXCLUDED.encrypted_api_key,
    encrypted_secret_key = EXCLUDED.encrypted_secret_key,
    master_password_hash = EXCLUDED.master_password_hash,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION vault_get_keys(
  p_user_id UUID,
  p_encryption_key TEXT
) RETURNS TABLE(api_key TEXT, secret_key TEXT) AS $$
BEGIN
  RETURN QUERY
  SELECT
    extensions.pgp_sym_decrypt(v.encrypted_api_key::bytea, p_encryption_key)::TEXT,
    extensions.pgp_sym_decrypt(v.encrypted_secret_key::bytea, p_encryption_key)::TEXT
  FROM vault v
  WHERE v.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION vault_get_password_hash(
  p_user_id UUID
) RETURNS TEXT AS $$
  SELECT master_password_hash FROM vault WHERE user_id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION vault_clear_keys(
  p_user_id UUID
) RETURNS VOID AS $$
  DELETE FROM vault WHERE user_id = p_user_id;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vault ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_analysis ENABLE ROW LEVEL SECURITY;

-- Users
CREATE POLICY "users_read_own" ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_insert_own" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid() = id);
-- Soft-delete only: users can't truly delete, just mark deleted_at
CREATE POLICY "users_soft_delete_own" ON users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Vault (restricted — no direct SELECT/INSERT/UPDATE from client)
CREATE POLICY "vault_no_direct_access" ON vault
  FOR ALL USING (false);

-- Chat History
CREATE POLICY "chat_read_own" ON chat_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "chat_insert_own" ON chat_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Trade History
CREATE POLICY "trades_read_own" ON trade_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own" ON trade_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- AI Suggestions
CREATE POLICY "suggestions_read_own" ON ai_suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "suggestions_insert_own" ON ai_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "suggestions_update_own" ON ai_suggestions
  FOR UPDATE USING (auth.uid() = user_id);

-- Alerts
CREATE POLICY "alerts_read_own" ON alerts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "alerts_insert_own" ON alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "alerts_update_own" ON alerts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "alerts_delete_own" ON alerts
  FOR DELETE USING (auth.uid() = user_id);

-- Account Snapshots
CREATE POLICY "snapshots_read_own" ON account_snapshots
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "snapshots_insert_own" ON account_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Watchlists
CREATE POLICY "watchlists_read_own" ON watchlists
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "watchlists_insert_own" ON watchlists
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "watchlists_update_own" ON watchlists
  FOR UPDATE USING (auth.uid() = user_id);

-- Market Cache (public read, server-only write)
CREATE POLICY "cache_public_read" ON market_cache
  FOR SELECT USING (true);

-- Portfolio Analysis (user-scoped)
CREATE POLICY "pa_read_own" ON portfolio_analysis
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "pa_insert_own" ON portfolio_analysis
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pa_update_own" ON portfolio_analysis
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================================
-- UPDATED-AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_vault_updated_at') THEN
    CREATE TRIGGER trg_vault_updated_at
      BEFORE UPDATE ON vault
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
