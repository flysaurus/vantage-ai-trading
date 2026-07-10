-- 026: Add model_access tier feature for admin config V1
-- Run in Supabase SQL Editor.
-- Populates model_access per tier with safe defaults:
--   Demo: haiku+sonnet (full access during trial)
--   Silver: haiku+sonnet
--   Gold: haiku+sonnet

BEGIN;

-- 1. Add model_access tier feature
INSERT INTO public.tier_features (key, label, description, sort_order)
VALUES (
  'model_access',
  'Model access',
  'Which models this tier can use: haiku (Claude Haiku only) or haiku+sonnet (Haiku + Sonnet for deep analysis)',
  25
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- 2. Populate values per tier (haiku+sonnet for all by default)
DO $$
DECLARE
  v_demo_id UUID; v_silver_id UUID; v_gold_id UUID;
  v_fid UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM subscription_tiers WHERE key = 'gold';
  SELECT id INTO v_fid       FROM tier_features WHERE key = 'model_access';

  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_demo_id, v_fid, 'haiku+sonnet')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = 'haiku+sonnet';

  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_silver_id, v_fid, 'haiku+sonnet')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = 'haiku+sonnet';

  INSERT INTO tier_feature_values (tier_id, feature_id, value)
  VALUES (v_gold_id, v_fid, 'haiku+sonnet')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = 'haiku+sonnet';
END;
$$;

COMMIT;
