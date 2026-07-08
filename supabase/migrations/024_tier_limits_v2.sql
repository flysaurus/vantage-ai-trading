-- 024: Tier limits v2 — monthly caps, demo pool, surface counters
-- Run in Supabase SQL Editor.

BEGIN;

-- 1. Demo trial deep pool counter on users table
ALTER TABLE public.users 
  ADD COLUMN IF NOT EXISTS demo_deep_pool_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_chat_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_deep_used INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_monthly_reset DATE;

-- 2. Update tier_feature_values with correct limits
DO $$
DECLARE
  v_demo_id UUID; v_silver_id UUID; v_gold_id UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM subscription_tiers WHERE key = 'gold';

  -- Chat daily: Demo=25, Silver=45, Gold=90
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_demo_id, id, '25' FROM tier_features WHERE key = 'ai_message_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_silver_id, id, '45' FROM tier_features WHERE key = 'ai_message_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_gold_id, id, '90' FROM tier_features WHERE key = 'ai_message_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;

  -- Deep daily: Demo=5, Silver=4, Gold=8
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_demo_id, id, '5' FROM tier_features WHERE key = 'deep_analysis_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_silver_id, id, '4' FROM tier_features WHERE key = 'deep_analysis_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  SELECT v_gold_id, id, '8' FROM tier_features WHERE key = 'deep_analysis_limit'
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- 3. Add limit features for monthly/pool caps + other surfaces
INSERT INTO public.tier_features (key, label, description, sort_order)
VALUES
  ('monthly_chat_limit',   'Monthly chat messages',   'Total chat messages per calendar month', 15),
  ('monthly_deep_limit',   'Monthly deep analyses',   'Total deep analyses per calendar month', 16),
  ('demo_deep_pool',       'Demo trial deep pool',    'Total deep analyses across entire 30-day trial (demo only)', 17),
  ('daily_brief_limit',    'Daily briefs per day',    'Daily brief generations per day', 18),
  ('weekly_snapshot_limit','Weekly snapshots per day','Weekly snapshot generations per day', 19),
  ('greeting_limit',       'Greetings per day',       'Greeting generations per day', 20)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- 4. Populate new feature values per tier
DO $$
DECLARE
  v_demo_id UUID; v_silver_id UUID; v_gold_id UUID;
  v_fid UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM subscription_tiers WHERE key = 'gold';

  -- monthly_chat_limit: Demo=null (daily-only), Silver=750, Gold=1800
  SELECT id INTO v_fid FROM tier_features WHERE key = 'monthly_chat_limit';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '0') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '0';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '750') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '750';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '1800') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1800';

  -- monthly_deep_limit: Demo=0, Silver=25, Gold=55
  SELECT id INTO v_fid FROM tier_features WHERE key = 'monthly_deep_limit';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '0') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '0';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '25') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '25';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '55') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '55';

  -- demo_deep_pool: Demo=20 (trial pool), Silver=0 (n/a), Gold=0 (n/a)
  SELECT id INTO v_fid FROM tier_features WHERE key = 'demo_deep_pool';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '20') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '20';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '0') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '0';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '0') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '0';

  -- daily_brief_limit: all=1
  SELECT id INTO v_fid FROM tier_features WHERE key = 'daily_brief_limit';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';

  -- weekly_snapshot_limit: all=1
  SELECT id INTO v_fid FROM tier_features WHERE key = 'weekly_snapshot_limit';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';

  -- greeting_limit: all=1
  SELECT id INTO v_fid FROM tier_features WHERE key = 'greeting_limit';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, '1') ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = '1';
END;
$$;

-- 5. RPC: increment monthly/demo-pool counters with auto-reset
CREATE OR REPLACE FUNCTION increment_user_counters(
  p_user_id UUID,
  p_chat_delta INTEGER DEFAULT 0,
  p_deep_delta INTEGER DEFAULT 0,
  p_deep_pool_delta INTEGER DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_current_month DATE := DATE_TRUNC('month', CURRENT_DATE);
  v_result JSONB;
BEGIN
  -- Auto-reset monthly counters if month changed (for all users)
  UPDATE users SET 
    monthly_chat_used = CASE WHEN last_monthly_reset < v_current_month OR last_monthly_reset IS NULL THEN 0 ELSE monthly_chat_used END,
    monthly_deep_used = CASE WHEN last_monthly_reset < v_current_month OR last_monthly_reset IS NULL THEN 0 ELSE monthly_deep_used END,
    last_monthly_reset = v_current_month
  WHERE id = p_user_id;

  -- Increment
  UPDATE users SET
    monthly_chat_used = monthly_chat_used + p_chat_delta,
    monthly_deep_used = monthly_deep_used + p_deep_delta,
    demo_deep_pool_used = demo_deep_pool_used + p_deep_pool_delta
  WHERE id = p_user_id
  RETURNING jsonb_build_object(
    'monthly_chat', monthly_chat_used,
    'monthly_deep', monthly_deep_used,
    'demo_deep_pool', demo_deep_pool_used
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::JSONB);
END;
$$;

-- 6. Update get_tier_limit to handle NULL gracefully (no hardcoded defaults)
CREATE OR REPLACE FUNCTION get_tier_limit(
  p_user_id UUID,
  p_feature_key TEXT
) RETURNS INTEGER
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $$
DECLARE
  v_limit INTEGER;
BEGIN
  SELECT COALESCE(NULLIF(fv.value, 'true'), '0')::INTEGER
  INTO v_limit
  FROM users u
  JOIN subscription_tiers t ON t.key = COALESCE(u.tier, 'demo')
  JOIN tier_feature_values fv ON fv.tier_id = t.id
  JOIN tier_features f ON f.id = fv.feature_id AND f.key = p_feature_key
  WHERE u.id = p_user_id;

  RETURN v_limit; -- NULL if no match (caller handles)
END;
$$;

COMMIT;
