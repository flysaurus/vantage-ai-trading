-- ═══════════════════════════════════════════════════
-- Migration: 080 — seed `noticed_check_limit`
-- Purpose: `lib/ai-guard.ts` gates the "Rufus Noticed" pipeline on
--          `checkUsageLimit(userId,'noticed')`, which reads the tier feature
--          `noticed_check_limit`. That feature row was NEVER seeded (the key
--          appears only in `lib/ai-guard.ts`), so `get_tier_limit()` returned
--          NULL, `getUserTierLimit()` threw, and the guard fail-CLOSED:
--
--            • 400/400 `ai_generation_log` rows for surface='noticed' since
--              2026-08-21 say "SKIPPED: Unable to verify noticed limit"
--            • zero noticed cards have EVER carried AI-written copy — every one
--              used the deterministic fallback text.
--
--          Companion code fix (same commit series): a NULL limit is now read as
--          "not configured ⇒ fail OPEN (uncapped)" instead of an outage, so this
--          can never hard-block a surface silently again.
--
-- Applied: 2026-09-18 by the assistant via PostgREST (service role); this file is
--          the record. Idempotent — safe to re-run in the Supabase SQL Editor.
--
-- Cap semantics: the daily counter is the number of `ai_generation_log` rows for
-- surface='noticed' today, and BLOCKED passes also log. So the value is "how many
-- noticed passes per day may spend an AI call"; the rest use fallback copy.
-- The QStash cron alone runs ~17 passes per market day (`*/30 13-21 * * 1-5`).
-- ═══════════════════════════════════════════════════

BEGIN;

INSERT INTO public.tier_features (key, label, description, sort_order)
VALUES (
  'noticed_check_limit',
  'Noticed checks per day',
  'Daily "Rufus noticed" rule passes allowed to spend an AI call',
  21
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- Per-tier values: demo 6 / silver 12 / gold 20.
DO $$
DECLARE
  v_demo_id UUID;
  v_silver_id UUID;
  v_gold_id UUID;
  v_fid UUID;
BEGIN
  SELECT id INTO v_demo_id   FROM public.subscription_tiers WHERE key = 'demo';
  SELECT id INTO v_silver_id FROM public.subscription_tiers WHERE key = 'silver';
  SELECT id INTO v_gold_id   FROM public.subscription_tiers WHERE key = 'gold';
  SELECT id INTO v_fid       FROM public.tier_features WHERE key = 'noticed_check_limit';

  INSERT INTO public.tier_feature_values (tier_id, feature_id, value)
  VALUES (v_demo_id, v_fid, '6')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.tier_feature_values (tier_id, feature_id, value)
  VALUES (v_silver_id, v_fid, '12')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.tier_feature_values (tier_id, feature_id, value)
  VALUES (v_gold_id, v_fid, '20')
  ON CONFLICT (tier_id, feature_id) DO UPDATE SET value = EXCLUDED.value;
END;
$$;

COMMIT;

-- Verify (read-only):
--   SELECT public.get_tier_limit('<user-uuid>', 'noticed_check_limit');  -- expect 6 for a demo-tier user
--   SELECT key, label, sort_order FROM public.tier_features WHERE key = 'noticed_check_limit';
