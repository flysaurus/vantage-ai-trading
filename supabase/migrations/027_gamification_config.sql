-- 027: Gamification config table + audit trail
-- Stores pillar weights, point caps, and milestone thresholds
-- as JSONB so the shape is flexible and admin-editable.
-- Audit trail logs every change with admin email, old/new values.

BEGIN;

-- 1. Config table — one row per config section
CREATE TABLE IF NOT EXISTS public.gamification_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS but allow service role only (admin API uses service role)
ALTER TABLE public.gamification_config ENABLE ROW LEVEL SECURITY;

-- 2. Audit trail
CREATE TABLE IF NOT EXISTS public.gamification_config_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email TEXT NOT NULL,
  config_key TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Seed default config
INSERT INTO public.gamification_config (key, value) VALUES
  (
    'pillar_weights',
    '{
      "discipline": 40,
      "understanding": 25,
      "construction": 20,
      "engagement": 15
    }'::JSONB
  ),
  (
    'point_caps',
    '{
      "streak_max": 90,
      "ai_max": 60,
      "learning_depth_max": 5,
      "learning_depth_points": 50,
      "style_consistency_max": 300,
      "drawdown_bonus": 100,
      "diversification_max": 150,
      "diversification_multiplier": 1.5,
      "position_sizing_max": 50,
      "position_sizing_ideal_pct": 25,
      "position_sizing_worst_pct": 50,
      "ai_session_tier1_count": 10,
      "ai_session_tier1_points": 3,
      "ai_session_tier2_count": 10,
      "ai_session_tier2_points": 2,
      "ai_session_tier3_points": 0.5,
      "streak_points_per_day": 3
    }'::JSONB
  ),
  (
    'milestone_thresholds',
    '{
      "true_to_style": {
        "trades_executed": 10,
        "match_rate": 0.70
      },
      "well_built": {
        "position_count": 5,
        "diversification_score": 70,
        "max_position_pct": 35
      },
      "student_of_the_game": {
        "learning_count": 5,
        "deep_engagement_count": 3
      },
      "steady_hands": {
        "drawdown_pct": 10
      },
      "weathered_a_storm": {
        "drawdown_pct": 10,
        "recovery_pct": 95
      }
    }'::JSONB
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
