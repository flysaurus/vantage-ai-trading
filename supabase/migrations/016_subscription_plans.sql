-- ═══════════════════════════════════════════════════
-- Migration: Subscription tiers + feature matrix
-- Purpose: Drive plans page from DB — add tiers,
--          features, add user_subscriptions, seed data.
--          Fully extensible: add tier/feature = INSERT.
-- Run in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════

BEGIN;

-- ── STEP 1: subscription_tiers ──────────────────

CREATE TABLE IF NOT EXISTS public.subscription_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE CHECK (key IN ('demo','silver','gold')),
  name TEXT NOT NULL,
  price_label TEXT NOT NULL DEFAULT 'TBD',  -- 'Free', 'TBD', or formatted price
  price_cents INTEGER,                      -- NULL = TBD / Free
  accent_color TEXT NOT NULL DEFAULT '#22d3ee',
  accent_bg TEXT NOT NULL DEFAULT 'rgba(34,211,238,0.06)',
  accent_border TEXT NOT NULL DEFAULT 'rgba(34,211,238,0.18)',
  badge_text TEXT,                           -- 'ACTIVE', 'RECOMMENDED', or NULL
  badge_bg TEXT,
  cta_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false, -- new users get this tier
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── STEP 2: tier_features ──────────────────────

CREATE TABLE IF NOT EXISTS public.tier_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,                  -- slug: 'ai_insights', 'live_trades'
  label TEXT NOT NULL,                       -- display: 'AI portfolio insights'
  description TEXT,                          -- optional longer description
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── STEP 3: tier_feature_values ────────────────

CREATE TABLE IF NOT EXISTS public.tier_feature_values (
  tier_id UUID NOT NULL REFERENCES public.subscription_tiers(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.tier_features(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT 'true',         -- 'true', 'false', or string like '1', 'Unlimited'
  PRIMARY KEY (tier_id, feature_id)
);

-- ── STEP 4: user_subscriptions ─────────────────

CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tier_id UUID NOT NULL REFERENCES public.subscription_tiers(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','canceled','expired','trialing')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subs_user_active
  ON public.user_subscriptions(user_id)
  WHERE status = 'active';

-- ── STEP 5: RLS ─────────────────────────────────

ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tier_feature_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Tiers & features: read-only for authenticated users
CREATE POLICY "Authenticated can read tiers"
  ON public.subscription_tiers FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can read features"
  ON public.tier_features FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Authenticated can read feature values"
  ON public.tier_feature_values FOR SELECT
  TO authenticated USING (true);

-- Users can read their own subscription
CREATE POLICY "Users can read own subscription"
  ON public.user_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ── STEP 6: Allow anon reads (plans page is public) ──

CREATE POLICY "Anon can read tiers"
  ON public.subscription_tiers FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can read features"
  ON public.tier_features FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon can read feature values"
  ON public.tier_feature_values FOR SELECT
  TO anon USING (true);

-- ── STEP 7: Seed data ───────────────────────────
-- Tiers
INSERT INTO public.subscription_tiers (key, name, price_label, price_cents, accent_color, accent_bg, accent_border, badge_text, badge_bg, cta_label, sort_order, is_default)
VALUES
  ('demo',   'Demo',   'Free', NULL, '#94a3b8', 'rgba(148,163,184,0.06)', 'rgba(148,163,184,0.15)', 'ACTIVE',      'rgba(148,163,184,0.15)', 'Current plan',   0, true),
  ('silver', 'Silver', 'TBD',  NULL, '#22d3ee', 'rgba(34,211,238,0.06)', 'rgba(34,211,238,0.18)', 'RECOMMENDED', 'rgba(34,211,238,0.18)', 'Coming soon',    1, false),
  ('gold',   'Gold',   'TBD',  NULL, '#fbbf24', 'rgba(251,191,36,0.06)', 'rgba(251,191,36,0.18)', NULL,          NULL,                      'Coming soon',    2, false)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  price_label = EXCLUDED.price_label,
  price_cents = EXCLUDED.price_cents,
  accent_color = EXCLUDED.accent_color,
  accent_bg = EXCLUDED.accent_bg,
  accent_border = EXCLUDED.accent_border,
  badge_text = EXCLUDED.badge_text,
  badge_bg = EXCLUDED.badge_bg,
  cta_label = EXCLUDED.cta_label,
  sort_order = EXCLUDED.sort_order,
  is_default = EXCLUDED.is_default;

-- Features
INSERT INTO public.tier_features (key, label, sort_order)
VALUES
  -- Core Features
  ('ai_insights',           'AI portfolio insights',       1),
  ('alerts_watchlists',     'Price alerts & watchlists',   2),
  ('macro_calendar',        'Macro / earnings calendar',   3),
  ('news_feed',             'AI-curated news feed',        4),
  ('paper_trading',         'Paper trading portfolio',     5),
  ('style_quiz',            'Investor style quiz',         6),
  -- Brokerage
  ('broker_readonly',       'Real brokerage (read-only)',  7),
  ('csv_import',            'CSV import',                  8),
  ('live_execution',        'Live trade execution',        9),
  ('options_futures',       'Options & futures',          10),
  -- Advanced
  ('totp_2fa',              'TOTP 2FA for real-money',    11),
  ('tax_lot_tracking',      'Tax lot tracking',           12),
  ('tax_loss_harvesting',   'Tax-loss harvesting',        13),
  ('csv_export',            'Excel / CSV portfolio export',14)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  sort_order = EXCLUDED.sort_order;

-- Feature values per tier
DO $$
DECLARE
  v_demo_id UUID;
  v_silver_id UUID;
  v_gold_id UUID;
  v_fid UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM subscription_tiers WHERE key = 'gold';

  -- Demo tier features
  FOR v_fid IN SELECT id FROM tier_features WHERE key IN (
    'ai_insights','alerts_watchlists','macro_calendar','news_feed','style_quiz'
  ) LOOP
    INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, 'true') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Paper trading: demo has '1'
  SELECT id INTO v_fid FROM tier_features WHERE key = 'paper_trading';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, '1') ON CONFLICT DO NOTHING;

  -- Everything else: demo = false
  FOR v_fid IN SELECT id FROM tier_features WHERE key IN (
    'broker_readonly','csv_import','live_execution','options_futures',
    'totp_2fa','tax_lot_tracking','tax_loss_harvesting','csv_export'
  ) LOOP
    INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_demo_id, v_fid, 'false') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Silver: all demo true + broker_readonly, csv_import
  FOR v_fid IN SELECT id FROM tier_features WHERE key IN (
    'ai_insights','alerts_watchlists','macro_calendar','news_feed','style_quiz',
    'broker_readonly','csv_import'
  ) LOOP
    INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, 'true') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Paper trading: silver has '1'
  SELECT id INTO v_fid FROM tier_features WHERE key = 'paper_trading';
  INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, '1') ON CONFLICT DO NOTHING;

  -- Silver: rest = false
  FOR v_fid IN SELECT id FROM tier_features WHERE key IN (
    'live_execution','options_futures','totp_2fa','tax_lot_tracking','tax_loss_harvesting','csv_export'
  ) LOOP
    INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_silver_id, v_fid, 'false') ON CONFLICT DO NOTHING;
  END LOOP;

  -- Gold: everything = true except paper_trading = '1'
  FOR v_fid IN SELECT id FROM tier_features LOOP
    INSERT INTO tier_feature_values (tier_id, feature_id, value) VALUES (v_gold_id, v_fid, 'true') ON CONFLICT DO NOTHING;
  END LOOP;

  SELECT id INTO v_fid FROM tier_features WHERE key = 'paper_trading';
  UPDATE tier_feature_values SET value = '1' WHERE tier_id = v_gold_id AND feature_id = v_fid;

END;
$$;

-- ── STEP 8: Helper function ─────────────────────

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id UUID)
RETURNS TABLE (
  tier_key TEXT,
  tier_name TEXT,
  price_label TEXT,
  accent_color TEXT
) LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT t.key, t.name, t.price_label, t.accent_color
  FROM user_subscriptions us
  JOIN subscription_tiers t ON t.id = us.tier_id
  WHERE us.user_id = p_user_id AND us.status = 'active'
  LIMIT 1;

  -- Fallback: default tier
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT t.key, t.name, t.price_label, t.accent_color
    FROM subscription_tiers t
    WHERE t.is_default = true
    LIMIT 1;
  END IF;
END;
$$;

COMMIT;
