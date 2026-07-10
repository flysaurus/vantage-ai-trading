// ─── Gamification Config Reader ────────────────────────────────
// Reads pillar weights, point caps, and milestone thresholds from
// the gamification_config table. Falls back to hardcoded defaults
// if the table doesn't exist yet (pre-migration) or DB is unreachable.
//
// Config is read on every score calculation (not cached) because:
//   1. The table has exactly 3 rows (indexed by key)
//   2. Changes are rare (admin manual edits only)
//   3. Caching would add staleness risk with no meaningful perf gain

import { createServerClient } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────

export interface PillarWeights {
  discipline: number;
  understanding: number;
  construction: number;
  engagement: number;
}

export interface PointCaps {
  streak_max: number;
  ai_max: number;
  learning_depth_max: number;
  learning_depth_points: number;
  style_consistency_max: number;
  drawdown_bonus: number;
  diversification_max: number;
  diversification_multiplier: number;
  position_sizing_max: number;
  position_sizing_ideal_pct: number;
  position_sizing_worst_pct: number;
  ai_session_tier1_count: number;
  ai_session_tier1_points: number;
  ai_session_tier2_count: number;
  ai_session_tier2_points: number;
  ai_session_tier3_points: number;
  streak_points_per_day: number;
}

export interface MilestoneThreshold {
  // true_to_style
  true_to_style_trades: number;
  true_to_style_match_rate: number;
  // well_built
  well_built_positions: number;
  well_built_diversification: number;
  well_built_max_position_pct: number;
  // student_of_the_game
  student_learning_count: number;
  student_deep_count: number;
  // steady_hands
  steady_hands_drawdown_pct: number;
  // weathered_a_storm
  weathered_drawdown_pct: number;
  weathered_recovery_pct: number;
}

export interface GamificationConfig {
  weights: PillarWeights;
  caps: PointCaps;
  milestones: MilestoneThreshold;
}

// ─── Hardcoded Defaults ───────────────────────────────────────
// Used when DB is unavailable or config table doesn't exist yet.
// MUST stay in sync with the seed values in migration 027.

const DEFAULT_WEIGHTS: PillarWeights = {
  discipline: 40,
  understanding: 25,
  construction: 20,
  engagement: 15,
};

const DEFAULT_CAPS: PointCaps = {
  streak_max: 90,
  ai_max: 60,
  learning_depth_max: 5,
  learning_depth_points: 50,
  style_consistency_max: 300,
  drawdown_bonus: 100,
  diversification_max: 150,
  diversification_multiplier: 1.5,
  position_sizing_max: 50,
  position_sizing_ideal_pct: 25,
  position_sizing_worst_pct: 50,
  ai_session_tier1_count: 10,
  ai_session_tier1_points: 3,
  ai_session_tier2_count: 10,
  ai_session_tier2_points: 2,
  ai_session_tier3_points: 0.5,
  streak_points_per_day: 3,
};

const DEFAULT_MILESTONES: MilestoneThreshold = {
  true_to_style_trades: 10,
  true_to_style_match_rate: 0.7,
  well_built_positions: 5,
  well_built_diversification: 70,
  well_built_max_position_pct: 35,
  student_learning_count: 5,
  student_deep_count: 3,
  steady_hands_drawdown_pct: 10,
  weathered_drawdown_pct: 10,
  weathered_recovery_pct: 95,
};

// ─── Reader ───────────────────────────────────────────────────

/**
 * Fetch the full gamification config from DB.
 * Falls back to hardcoded defaults on any failure.
 */
export async function getGamificationConfig(): Promise<GamificationConfig> {
  try {
    const supabase = createServerClient();

    const { data: rows, error } = await (supabase as any)
      .from('gamification_config')
      .select('key, value');

    if (error || !rows || rows.length === 0) {
      console.warn(
        '[gamification config] DB read failed or empty, using defaults:',
        error?.message || 'no rows',
      );
      return defaultConfig();
    }

    const map: Record<string, any> = {};
    for (const r of rows) map[r.key] = r.value;

    return {
      weights: parseWeights(map.pillar_weights),
      caps: parseCaps(map.point_caps),
      milestones: parseMilestones(map.milestone_thresholds),
    };
  } catch (err: any) {
    console.warn('[gamification config] Exception, using defaults:', err.message);
    return defaultConfig();
  }
}

function defaultConfig(): GamificationConfig {
  return {
    weights: { ...DEFAULT_WEIGHTS },
    caps: { ...DEFAULT_CAPS },
    milestones: { ...DEFAULT_MILESTONES },
  };
}

// ─── Parsers (defensive — return default if shape is wrong) ───

function parseWeights(raw: any): PillarWeights {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEIGHTS };
  return {
    discipline: Number(raw.discipline) || DEFAULT_WEIGHTS.discipline,
    understanding: Number(raw.understanding) || DEFAULT_WEIGHTS.understanding,
    construction: Number(raw.construction) || DEFAULT_WEIGHTS.construction,
    engagement: Number(raw.engagement) || DEFAULT_WEIGHTS.engagement,
  };
}

function parseCaps(raw: any): PointCaps {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CAPS };
  return {
    streak_max: Number(raw.streak_max) || DEFAULT_CAPS.streak_max,
    ai_max: Number(raw.ai_max) || DEFAULT_CAPS.ai_max,
    learning_depth_max: Number(raw.learning_depth_max) || DEFAULT_CAPS.learning_depth_max,
    learning_depth_points: Number(raw.learning_depth_points) || DEFAULT_CAPS.learning_depth_points,
    style_consistency_max: Number(raw.style_consistency_max) || DEFAULT_CAPS.style_consistency_max,
    drawdown_bonus: Number(raw.drawdown_bonus) || DEFAULT_CAPS.drawdown_bonus,
    diversification_max: Number(raw.diversification_max) || DEFAULT_CAPS.diversification_max,
    diversification_multiplier: Number(raw.diversification_multiplier) || DEFAULT_CAPS.diversification_multiplier,
    position_sizing_max: Number(raw.position_sizing_max) || DEFAULT_CAPS.position_sizing_max,
    position_sizing_ideal_pct: Number(raw.position_sizing_ideal_pct) || DEFAULT_CAPS.position_sizing_ideal_pct,
    position_sizing_worst_pct: Number(raw.position_sizing_worst_pct) || DEFAULT_CAPS.position_sizing_worst_pct,
    ai_session_tier1_count: Number(raw.ai_session_tier1_count) || DEFAULT_CAPS.ai_session_tier1_count,
    ai_session_tier1_points: Number(raw.ai_session_tier1_points) || DEFAULT_CAPS.ai_session_tier1_points,
    ai_session_tier2_count: Number(raw.ai_session_tier2_count) || DEFAULT_CAPS.ai_session_tier2_count,
    ai_session_tier2_points: Number(raw.ai_session_tier2_points) || DEFAULT_CAPS.ai_session_tier2_points,
    ai_session_tier3_points: Number(raw.ai_session_tier3_points) || DEFAULT_CAPS.ai_session_tier3_points,
    streak_points_per_day: Number(raw.streak_points_per_day) || DEFAULT_CAPS.streak_points_per_day,
  };
}

function parseMilestones(raw: any): MilestoneThreshold {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MILESTONES };
  const tts = raw.true_to_style || {};
  const wb = raw.well_built || {};
  const sotg = raw.student_of_the_game || {};
  const sh = raw.steady_hands || {};
  const was = raw.weathered_a_storm || {};
  return {
    true_to_style_trades: Number(tts.trades_executed) || DEFAULT_MILESTONES.true_to_style_trades,
    true_to_style_match_rate: Number(tts.match_rate) || DEFAULT_MILESTONES.true_to_style_match_rate,
    well_built_positions: Number(wb.position_count) || DEFAULT_MILESTONES.well_built_positions,
    well_built_diversification: Number(wb.diversification_score) || DEFAULT_MILESTONES.well_built_diversification,
    well_built_max_position_pct: Number(wb.max_position_pct) || DEFAULT_MILESTONES.well_built_max_position_pct,
    student_learning_count: Number(sotg.learning_count) || DEFAULT_MILESTONES.student_learning_count,
    student_deep_count: Number(sotg.deep_engagement_count) || DEFAULT_MILESTONES.student_deep_count,
    steady_hands_drawdown_pct: Number(sh.drawdown_pct) || DEFAULT_MILESTONES.steady_hands_drawdown_pct,
    weathered_drawdown_pct: Number(was.drawdown_pct) || DEFAULT_MILESTONES.weathered_drawdown_pct,
    weathered_recovery_pct: Number(was.recovery_pct) || DEFAULT_MILESTONES.weathered_recovery_pct,
  };
}
