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

-- Enhanced columns (add if missing)
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS message_type TEXT CHECK (message_type IN ('user_message', 'ai_response'));
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS investor_style TEXT;
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS related_stocks JSONB DEFAULT '[]';
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Migrate existing role to message_type for backward compat
UPDATE chat_history SET message_type = CASE WHEN role = 'user' THEN 'user_message' WHEN role IN ('assistant', 'system') THEN 'ai_response' END WHERE message_type IS NULL;

CREATE INDEX idx_chat_user_created ON chat_history(user_id, created_at DESC);

-- ── Trade History ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alpaca_order_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  action TEXT CHECK (action IN ('buy', 'sell')),
  type TEXT NOT NULL DEFAULT 'market',
  qty NUMERIC NOT NULL,
  quantity NUMERIC,
  filled_price NUMERIC,
  price NUMERIC,
  total_value NUMERIC,
  commission NUMERIC DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'filled',
  bracket JSONB,
  ai_suggestion_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  filled_at TIMESTAMPTZ
);

ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS action TEXT CHECK (action IN ('buy', 'sell'));
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS quantity NUMERIC;
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS price NUMERIC;
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS commission NUMERIC DEFAULT 0;
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
-- Migrate old columns
UPDATE trade_history SET action = side WHERE action IS NULL;
UPDATE trade_history SET quantity = qty WHERE quantity IS NULL;
UPDATE trade_history SET price = filled_price WHERE price IS NULL;
UPDATE trade_history SET executed_at = COALESCE(filled_at, created_at) WHERE executed_at IS NULL;

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
  alert_type TEXT NOT NULL CHECK (alert_type IN ('price_above', 'price_below', 'percent_change')),
  target_value NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_type TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS target_value NUMERIC;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS notification_channels TEXT[] DEFAULT ARRAY['in_app']::TEXT[];
-- Migrate old columns to new names
UPDATE alerts SET alert_type = type WHERE alert_type IS NULL AND type IS NOT NULL;
UPDATE alerts SET target_value = threshold WHERE target_value IS NULL AND threshold IS NOT NULL;

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

-- ── Metrics (portfolio snapshots for historical charts) ──────
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_value NUMERIC(15,2),
  total_gain NUMERIC(15,2),
  total_return NUMERIC(10,4),
  portfolio_yield NUMERIC(10,4),
  avg_pe NUMERIC(10,2),
  concentration_risk NUMERIC(5,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_metrics_user ON metrics(user_id, recorded_at DESC);

-- ── Watchlists ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Default',
  description TEXT,
  stocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add columns if missing (for existing tables)
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE watchlists ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
-- Rename symbols->stocks if old name exists
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='watchlists' AND column_name='symbols') THEN
    ALTER TABLE watchlists RENAME COLUMN symbols TO stocks;
  END IF;
END $$;

CREATE INDEX idx_watchlists_user ON watchlists(user_id);

-- ── Sessions (auth tokens) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(token);

-- ── Recent Notifications ────────────────────────────────────
CREATE TABLE IF NOT EXISTS recent_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT,
  type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('alert', 'suggestion', 'info')),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON recent_notifications(user_id, created_at DESC);

-- ── Daily Suggestions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion_text TEXT NOT NULL,
  related_stocks JSONB DEFAULT '[]'::jsonb,
  action_suggested TEXT,
  is_acted_upon BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_daily_suggestions_user ON daily_suggestions(user_id, created_at DESC);

-- ── Scanner Recommendations ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scanner_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('BUY_MORE', 'HOLD', 'SELL')),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scanner_recs_user ON scanner_recommendations(user_id, created_at DESC);
-- ── Strategies ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  investor_style TEXT CHECK (investor_style IN ('buffett', 'lynch', 'livermore', 'soros', 'munger')),
  target_allocation JSONB DEFAULT '{}'::jsonb,
  stocks JSONB DEFAULT '[]'::jsonb,
  performance_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_strategies_user ON strategies(user_id, created_at DESC);

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
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recent_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scanner_recommendations ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY "chat_update_own" ON chat_history
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "chat_delete_own" ON chat_history
  FOR DELETE USING (auth.uid() = user_id);

-- Trade History
CREATE POLICY "trades_read_own" ON trade_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "trades_insert_own" ON trade_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "trades_update_own" ON trade_history
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "trades_delete_own" ON trade_history
  FOR DELETE USING (auth.uid() = user_id);

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
CREATE POLICY "watchlists_delete_own" ON watchlists
  FOR DELETE USING (auth.uid() = user_id);

-- Strategies
CREATE POLICY "strategies_read_own" ON strategies
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "strategies_insert_own" ON strategies
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "strategies_update_own" ON strategies
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "strategies_delete_own" ON strategies
-- Metrics
CREATE POLICY "metrics_read_own" ON metrics
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "metrics_insert_own" ON metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "metrics_delete_own" ON metrics
-- Sessions
CREATE POLICY "sessions_read_own" ON sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Notifications
CREATE POLICY "notifications_read_own" ON recent_notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON recent_notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON recent_notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON recent_notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Daily Suggestions
CREATE POLICY "daily_read_own" ON daily_suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_insert_own" ON daily_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scanner Recommendations
CREATE POLICY "scanner_read_own" ON scanner_recommendations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scanner_insert_own" ON scanner_recommendations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scanner_delete_own" ON scanner_recommendations
  FOR DELETE USING (auth.uid() = user_id);
  FOR DELETE USING (auth.uid() = user_id);
-- Sessions
CREATE POLICY "sessions_read_own" ON sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Notifications
CREATE POLICY "notifications_read_own" ON recent_notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON recent_notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON recent_notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON recent_notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Daily Suggestions
CREATE POLICY "daily_read_own" ON daily_suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_insert_own" ON daily_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scanner Recommendations
CREATE POLICY "scanner_read_own" ON scanner_recommendations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scanner_insert_own" ON scanner_recommendations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scanner_delete_own" ON scanner_recommendations
  FOR DELETE USING (auth.uid() = user_id);
  FOR DELETE USING (auth.uid() = user_id);
-- Metrics
CREATE POLICY "metrics_read_own" ON metrics
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "metrics_insert_own" ON metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "metrics_delete_own" ON metrics
-- Sessions
CREATE POLICY "sessions_read_own" ON sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Notifications
CREATE POLICY "notifications_read_own" ON recent_notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON recent_notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON recent_notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON recent_notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Daily Suggestions
CREATE POLICY "daily_read_own" ON daily_suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_insert_own" ON daily_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scanner Recommendations
CREATE POLICY "scanner_read_own" ON scanner_recommendations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scanner_insert_own" ON scanner_recommendations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scanner_delete_own" ON scanner_recommendations
  FOR DELETE USING (auth.uid() = user_id);
  FOR DELETE USING (auth.uid() = user_id);
-- Sessions
CREATE POLICY "sessions_read_own" ON sessions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "sessions_insert_own" ON sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON sessions
  FOR DELETE USING (auth.uid() = user_id);

-- Notifications
CREATE POLICY "notifications_read_own" ON recent_notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "notifications_insert_own" ON recent_notifications
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notifications_update_own" ON recent_notifications
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "notifications_delete_own" ON recent_notifications
  FOR DELETE USING (auth.uid() = user_id);

-- Daily Suggestions
CREATE POLICY "daily_read_own" ON daily_suggestions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "daily_insert_own" ON daily_suggestions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Scanner Recommendations
CREATE POLICY "scanner_read_own" ON scanner_recommendations
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "scanner_insert_own" ON scanner_recommendations
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "scanner_delete_own" ON scanner_recommendations
  FOR DELETE USING (auth.uid() = user_id);

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
