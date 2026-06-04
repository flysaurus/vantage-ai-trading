-- ═══════════════════════════════════════════════════════════════
-- AI Usage Tracking — daily limits per user
-- ═══════════════════════════════════════════════════════════════

-- 1. Usage tracking table
CREATE TABLE IF NOT EXISTS ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  message_count INTEGER DEFAULT 0,
  deep_analysis_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd NUMERIC(12,6) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_date ON ai_usage(user_id, date);

-- 2. UPSERT RPC — safely increments counters in one call
CREATE OR REPLACE FUNCTION increment_ai_usage(
  p_user_id UUID,
  p_date DATE,
  p_message_increment INTEGER DEFAULT 0,
  p_analysis_increment INTEGER DEFAULT 0,
  p_tokens INTEGER DEFAULT 0,
  p_cost NUMERIC DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO ai_usage (user_id, date, message_count, deep_analysis_count, total_tokens, total_cost_usd)
  VALUES (p_user_id, p_date, p_message_increment, p_analysis_increment, p_tokens, p_cost)
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    message_count = ai_usage.message_count + p_message_increment,
    deep_analysis_count = ai_usage.deep_analysis_count + p_analysis_increment,
    total_tokens = ai_usage.total_tokens + p_tokens,
    total_cost_usd = ai_usage.total_cost_usd + p_cost,
    updated_at = now();
END;
$$;
