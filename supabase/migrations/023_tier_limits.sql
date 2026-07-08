-- 023: Tier-based limits & feature gating (v2 — zero hardcoded values)
-- Adds ai_message_limit and deep_analysis_limit to tier_features
-- Populates per-tier values: demo=25, silver=25, gold=50
-- Run in Supabase SQL Editor.

-- Add limit features
INSERT INTO public.tier_features (key, label, description, sort_order)
VALUES
  ('ai_message_limit', 'AI chat messages (per day)', 'Daily AI chat message allowance', 0),
  ('deep_analysis_limit', 'Deep analysis (per day)', 'Daily deep analysis allowance', 1)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- Populate per-tier values
DO $$
DECLARE
  v_demo_id UUID;
  v_silver_id UUID;
  v_gold_id UUID;
  v_msg_fid UUID;
  v_deep_fid UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM subscription_tiers WHERE key = 'gold';
  SELECT id INTO v_msg_fid   FROM tier_features WHERE key = 'ai_message_limit';
  SELECT id INTO v_deep_fid  FROM tier_features WHERE key = 'deep_analysis_limit';

  -- Demo: 25 / 20
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_demo_id, v_msg_fid, '25'), (v_demo_id, v_deep_fid, '20')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;

  -- Silver: 25 / 20
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_silver_id, v_msg_fid, '25'), (v_silver_id, v_deep_fid, '20')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;

  -- Gold: 50 / 50
  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_gold_id, v_msg_fid, '50'), (v_gold_id, v_deep_fid, '50')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

-- Function: get tier limit from DB — NO hardcoded defaults
CREATE OR REPLACE FUNCTION get_tier_limit(
  p_user_id UUID,
  p_feature_key TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
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

  -- If no row found (user or feature missing), return NULL
  -- Caller handles the NULL case
  RETURN v_limit;
END;
$$;
