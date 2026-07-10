// ─── Gamification: Server Actions v2 ────────────────────────
// Four-pillar scoring + milestone detection.
// ALL gamification writes go through these server actions.
// Uses SUPABASE_SERVICE_ROLE_KEY — never reaches the browser.
//
// Milestones detected in this pass:
//   Steady Hands     — held through ≥10% position drawdown
//   True to Style    — ≥10 trades with ≥70% style match rate
//   Well-Built       — ≥5 positions, diversification ≥70, max position <35%
//   Student of the Game — ≥5 learning moments, ≥3 with depth engagement
//   Weathered a Storm — drawdown tracking (lib/gamification/drawdown.ts)

import { createServerClient } from '@/lib/supabase';
import {
  calculateInvestorScore,
  inferTradeStyle,
  MAX_SCORE,
} from '@/lib/investor-score/calculate';
import type { ScoreMetrics } from '@/lib/investor-score/calculate';
import { updateDrawdownTracking } from '@/lib/gamification/drawdown';
import { getGamificationConfig } from '@/lib/gamification/config';

// ─── Types ────────────────────────────────────────────────────

export interface AwardMilestoneResult {
  awarded: boolean;
  milestoneKey: string;
  reason?: string;
}

export interface UpdateScoreResult {
  success: boolean;
  totalScore: number;
  milestonesEarned: number;
  weatheredStormAwarded?: boolean;
}

export interface ScoreWithBreakdown extends UpdateScoreResult {
  breakdown: {
    discipline: number;
    understanding: number;
    construction: number;
    engagement: number;
    styleConsistency: number;
    drawdownBonus: number;
    learningDepth: number;
    diversification: number;
    positionSizing: number;
    streakPoints: number;
    aiSessionPoints: number;
  };
}

// ─── Milestone Keys ──────────────────────────────────────────

const MILESTONE = {
  STEADY_HANDS: 'steady_hands',
  TRUE_TO_STYLE: 'true_to_style',
  WELL_BUILT: 'well_built',
  STUDENT_OF_THE_GAME: 'student_of_the_game',
  WEATHERED_A_STORM: 'weathered_a_storm',
} as const;

// ─── Milestone Awarding ──────────────────────────────────────

/**
 * Award a milestone to an anonymous user.
 * Idempotent — if already awarded, returns { awarded: false }.
 */
export async function awardMilestone(
  anonymousId: string,
  milestoneKey: string,
): Promise<AwardMilestoneResult> {
  if (!anonymousId || !milestoneKey) {
    return { awarded: false, milestoneKey, reason: 'Missing params' };
  }

  const supabase = createServerClient();

  try {
    const { error, count } = await (supabase as any)
      .from('milestones')
      .upsert(
        {
          anonymous_id: anonymousId,
          milestone_key: milestoneKey,
          milestone_label: milestoneKey,
          awarded_at: new Date().toISOString(),
        },
        { onConflict: 'anonymous_id,milestone_key', ignoreDuplicates: true },
      );

    if (error) {
      if (error.code === '23505') {
        return { awarded: false, milestoneKey, reason: 'Already awarded' };
      }
      console.error('[gamification] Award error:', error.message);
      return { awarded: false, milestoneKey, reason: error.message };
    }

    // ignoreDuplicates: true returns count=0 when row already exists
    const wasAwarded = count !== 0;
    if (wasAwarded) {
      console.log(
        `[gamification] 🏆 ${milestoneKey} awarded to ${anonymousId.slice(0, 8)}...`,
      );
    }
    return { awarded: wasAwarded, milestoneKey };
  } catch (err: any) {
    console.error('[gamification] Award exception:', err.message);
    return { awarded: false, milestoneKey, reason: err.message };
  }
}

/**
 * Check if a milestone has already been awarded.
 */
async function hasMilestone(
  supabase: any,
  anonymousId: string,
  milestoneKey: string,
): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('milestones')
      .select('id')
      .eq('anonymous_id', anonymousId)
      .eq('milestone_key', milestoneKey)
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Fetch all milestones for an anonymous user.
 */
export async function getMilestones(
  anonymousId: string,
): Promise<{ key: string; awarded_at: string }[]> {
  if (!anonymousId) return [];

  const supabase = createServerClient();

  try {
    const { data, error } = await (supabase as any)
      .from('milestones')
      .select('milestone_key, awarded_at')
      .eq('anonymous_id', anonymousId)
      .order('awarded_at', { ascending: true });

    if (error) {
      console.error('[gamification] Fetch milestones error:', error.message);
      return [];
    }

    return (data || []).map((m: any) => ({
      key: m.milestone_key,
      awarded_at: m.awarded_at,
    }));
  } catch (err: any) {
    console.error('[gamification] Fetch milestones exception:', err.message);
    return [];
  }
}

// ─── Score Management ────────────────────────────────────────

/**
 * Get or create an investor score row.
 * New rows start at 0 for all counters — no generous defaults.
 */
async function getOrCreateScore(anonymousId: string): Promise<any> {
  const supabase = createServerClient();

  const { data: existing } = await (supabase as any)
    .from('investor_scores')
    .select('*')
    .eq('anonymous_id', anonymousId)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await (supabase as any)
    .from('investor_scores')
    .insert({
      anonymous_id: anonymousId,
      baskets_created: 0,
      trades_executed: 0,
      ai_sessions: 0,
      milestones_earned: 0,
      total_score: 0,
      style_consistency: 0,
      risk_adherence: 0,
      diversification_score: 0,
      learning_count: 0,
      matching_trades: 0,
      streak_bonus: 0,
    })
    .select('*')
    .single();

  if (error) {
    console.error('[gamification] Score creation error:', error.message);
    return null;
  }

  return created;
}

// ─── Unified Score Computation ───────────────────────────────

interface ComputeOverrides {
  heldThroughDrawdown?: boolean;
  positionCount?: number;
  maxPositionPct?: number;
  deepEngagementCount?: number;
  investorStyle?: string;
}

/**
 * Compute the investor score using the four-pillar formula and write to DB.
 * This is the SINGLE source of truth — all score writes go through here.
 */
async function computeAndWriteScore(
  supabase: any,
  anonymousId: string,
  row: any,
  extraUpdates: Record<string, any> = {},
  overrides: ComputeOverrides = {},
): Promise<number> {
  // Fetch current streak from streaks table
  let currentStreak = 0;
  try {
    const { data: streak } = await supabase
      .from('streaks')
      .select('current_streak')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();
    currentStreak = streak?.current_streak || 0;
  } catch {
    // Non-fatal
  }

  const metrics: ScoreMetrics = {
    trades_executed: row.trades_executed || 0,
    matching_trades: row.matching_trades || 0,
    held_through_drawdown: overrides.heldThroughDrawdown ?? false,
    learning_count: row.learning_count || 0,
    deep_engagement_count: overrides.deepEngagementCount ?? (row.deep_engagement_count || 0),
    diversification_score: row.diversification_score || 0,
    position_count: overrides.positionCount ?? 0,
    max_position_pct: overrides.maxPositionPct ?? 0,
    current_streak: currentStreak,
    ai_sessions: row.ai_sessions || 0,
  };

  const result = calculateInvestorScore(
    metrics,
    overrides.investorStyle,
    await getGamificationConfig(),
  );

  const { error: updateErr } = await supabase
    .from('investor_scores')
    .update({
      total_score: result.score,
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      level: result.level,
      level_index: result.levelIndex,
      ...extraUpdates,
    })
    .eq('anonymous_id', anonymousId);

  if (updateErr) {
    // If the error is about a missing column (likely deep_engagement_count
    // before migration), strip unrecognized keys and retry once.
    // Error message formats vary:
    //   - SDK: "Could not find the 'col' column of 'table' in the schema cache"
    //   - REST: "column table.col does not exist"
    const isMissingColumn = /column/i.test(updateErr.message || '');
    if (isMissingColumn) {
      const knownColumns = new Set([
        'baskets_created', 'trades_executed', 'ai_sessions',
        'milestones_earned', 'total_score', 'style_consistency',
        'risk_adherence', 'diversification_score', 'learning_count',
        'matching_trades', 'streak_bonus', 'last_activity', 'updated_at',
        'level', 'level_index', 'max_position_pct', 'held_through_drawdown',
        'position_count',
      ]);
      const cleaned = Object.fromEntries(
        Object.entries(extraUpdates).filter(([k]) => knownColumns.has(k)),
      );
      console.warn(
        `[gamification] Stripped unknown columns, retrying with: ${Object.keys(cleaned).join(', ')}`,
      );
      const { error: retryErr } = await (supabase as any)
        .from('investor_scores')
        .update({
          total_score: result.score,
          last_activity: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          level: result.level,
          level_index: result.levelIndex,
          ...cleaned,
        })
        .eq('anonymous_id', anonymousId);

      if (retryErr) {
        console.error(
          '[gamification] Retry update also failed:',
          retryErr.message,
        );
        throw new Error(`Score persist failed: ${retryErr.message}`);
      }
    } else {
      console.error(
        '[gamification] Score update failed for',
        anonymousId.slice(0, 8) + '...',
        ':',
        updateErr.message,
      );
      throw new Error(`Score persist failed: ${updateErr.message}`);
    }
  }

  return result.score;
}

// ─── Milestone Detection ─────────────────────────────────────

/**
 * Check Steady Hands: held through ≥10% position drawdown.
 * Computed statelessly from current position data — no new DB columns.
 *
 * Caller provides whether any position is ≥10% underwater from entry.
 * This is determined at the application layer by comparing entry prices
 * to current market prices.
 *
 * LIMITATION: Only detects currently-held underwater positions.
 * The historical case — bought, dipped ≥10% intra-hold, then sold at/above entry —
 * is NOT computable from trade_history alone (requires per-position price history).
 */
async function checkAndAwardSteadyHands(
  supabase: any,
  anonymousId: string,
  heldThroughDrawdown: boolean,
): Promise<boolean> {
  if (!heldThroughDrawdown) return false;
  const already = await hasMilestone(supabase, anonymousId, MILESTONE.STEADY_HANDS);
  if (already) return false;
  const result = await awardMilestone(anonymousId, MILESTONE.STEADY_HANDS);
  return result.awarded;
}

/**
 * Check True to Style: ≥10 trades with ≥70% style match rate.
 * Called after each trade execution.
 */
async function checkAndAwardTrueToStyle(
  supabase: any,
  anonymousId: string,
  row: any,
  thresholds?: { trades: number; matchRate: number },
): Promise<boolean> {
  const t = thresholds ?? { trades: 10, matchRate: 0.7 };
  const trades = row.trades_executed || 0;
  const matches = row.matching_trades || 0;
  if (trades < t.trades) return false;
  if (trades === 0 || matches / trades < t.matchRate) return false;

  const already = await hasMilestone(supabase, anonymousId, MILESTONE.TRUE_TO_STYLE);
  if (already) return false;

  const result = await awardMilestone(anonymousId, MILESTONE.TRUE_TO_STYLE);
  return result.awarded;
}

/**
 * Check Well-Built: ≥5 positions, diversification ≥70, max position <35%.
 * Called when portfolio data is available.
 */
async function checkAndAwardWellBuilt(
  supabase: any,
  anonymousId: string,
  positionCount: number,
  diversificationScore: number,
  maxPositionPct: number,
  thresholds?: { positions: number; diversification: number; maxPosition: number },
): Promise<boolean> {
  const t = thresholds ?? { positions: 5, diversification: 70, maxPosition: 35 };
  if (positionCount < t.positions) return false;
  if (diversificationScore < t.diversification) return false;
  if (maxPositionPct >= t.maxPosition) return false;

  const already = await hasMilestone(supabase, anonymousId, MILESTONE.WELL_BUILT);
  if (already) return false;

  const result = await awardMilestone(anonymousId, MILESTONE.WELL_BUILT);
  return result.awarded;
}

/**
 * Check Student of the Game: ≥5 learning moments, ≥3 with depth.
 * Called after each Learning Moment completion.
 */
async function checkAndAwardStudentOfTheGame(
  supabase: any,
  anonymousId: string,
  learningCount: number,
  deepEngagementCount: number,
  thresholds?: { learning: number; deep: number },
): Promise<boolean> {
  const t = thresholds ?? { learning: 5, deep: 3 };
  if (learningCount < t.learning) return false;
  if (deepEngagementCount < t.deep) return false;

  const already = await hasMilestone(supabase, anonymousId, MILESTONE.STUDENT_OF_THE_GAME);
  if (already) return false;

  const result = await awardMilestone(anonymousId, MILESTONE.STUDENT_OF_THE_GAME);
  return result.awarded;
}

// ─── Activity Increment Functions ────────────────────────────

/**
 * Increment baskets_created and recalculate.
 * NOTE: baskets_created is no longer part of the score formula,
 * but we keep the counter for activity tracking.
 */
export async function incrementBasketsCreated(
  anonymousId: string,
  investorStyle?: string,
  /** Optional portfolio data for Construction pillar */
  positionCount?: number,
  maxPositionPct?: number,
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const config = await getGamificationConfig();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newBaskets = (row.baskets_created || 0) + 1;

  const totalScore = await computeAndWriteScore(
    supabase,
    anonymousId,
    { ...row, baskets_created: newBaskets },
    { baskets_created: newBaskets },
    {
      investorStyle,
      positionCount,
      maxPositionPct,
    },
  );

  return { success: true, totalScore, milestonesEarned: row.milestones_earned || 0 };
}

/**
 * Increment trades_executed, update style matching, and recalculate.
 * Also checks True to Style milestone.
 */
export async function incrementTradesExecuted(
  anonymousId: string,
  tradeAssetType?: string,
  tradeSector?: string,
  tradeHoldingDays?: number,
  basketStrategy?: string,
  investorStyle?: string,
  /** Portfolio-derived metrics (computed client-side from positions) */
  diversificationScore?: number,
  positionCount?: number,
  maxPositionPct?: number,
  heldThroughDrawdown?: boolean,
  /** Current portfolio equity (for drawdown tracking) */
  currentEquity?: number,
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const config = await getGamificationConfig();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newTrades = (row.trades_executed || 0) + 1;

  // Style matching via inferTradeStyle()
  const inferredStyle = inferTradeStyle({
    assetType: tradeAssetType,
    holdingDays: tradeHoldingDays,
    basketStrategy,
    sector: tradeSector,
  });
  const thisTradeMatches =
    investorStyle && inferredStyle === investorStyle;
  const prevMatches = row.matching_trades || 0;
  const newMatches = prevMatches + (thisTradeMatches ? 1 : 0);

  // Store running style consistency % for backwards compat
  const styleConsistency =
    newTrades > 0 ? Math.round((newMatches / newTrades) * 100) : 0;

  const newDiversification =
    diversificationScore ?? row.diversification_score ?? 0;

  const totalScore = await computeAndWriteScore(
    supabase,
    anonymousId,
    {
      ...row,
      trades_executed: newTrades,
      matching_trades: newMatches,
      diversification_score: newDiversification,
    },
    {
      trades_executed: newTrades,
      matching_trades: newMatches,
      style_consistency: styleConsistency,
      diversification_score: newDiversification,
    },
    {
      investorStyle,
      positionCount,
      maxPositionPct,
      heldThroughDrawdown,
    },
  );

  // ── Milestone checks ─────────────────────────────────────
  let milestoneAwarded = false;
  const updatedRow = { ...row, trades_executed: newTrades, matching_trades: newMatches };

  // True to Style
  const styleMilestone = await checkAndAwardTrueToStyle(supabase, anonymousId, updatedRow, {
    trades: config.milestones.true_to_style_trades,
    matchRate: config.milestones.true_to_style_match_rate,
  });
  if (styleMilestone) milestoneAwarded = true;

  // Steady Hands (if caller reports drawdown hold)
  if (heldThroughDrawdown) {
    const steadyMilestone = await checkAndAwardSteadyHands(
      supabase, anonymousId, heldThroughDrawdown,
    );
    if (steadyMilestone) milestoneAwarded = true;
  }

  // Well-Built (if caller provides portfolio data)
  if (positionCount !== undefined && maxPositionPct !== undefined) {
    const builtMilestone = await checkAndAwardWellBuilt(
      supabase, anonymousId, positionCount, newDiversification, maxPositionPct,
      {
        positions: config.milestones.well_built_positions,
        diversification: config.milestones.well_built_diversification,
        maxPosition: config.milestones.well_built_max_position_pct,
      },
    );
    if (builtMilestone) milestoneAwarded = true;
  }

  console.log(
    `[gamification] Trade #${newTrades}: inferred=${inferredStyle}` +
      ` declared=${investorStyle} match=${thisTradeMatches}` +
      ` consistency=${styleConsistency}%` +
      ` score=${totalScore}` +
      (milestoneAwarded ? ' 🏆' : ''),
  );

  // ── Drawdown tracking (Weathered a Storm) ────────────────
  let weatheredStormAwarded = false;
  if (currentEquity != null && currentEquity > 0) {
    try {
      const drawdownResult = await updateDrawdownTracking(
        anonymousId, currentEquity, supabase,
      );
      if (drawdownResult.milestoneAwarded) {
        weatheredStormAwarded = true;
        milestoneAwarded = true;
      }
    } catch (err: any) {
      console.warn('[gamification] Drawdown tracking failed (non-fatal):', err.message);
    }
  }

  return {
    success: true,
    totalScore,
    milestonesEarned: (row.milestones_earned || 0) + (milestoneAwarded ? 1 : 0),
    weatheredStormAwarded,
  };
}

/**
 * Increment ai_sessions and recalculate.
 * Engagement pillar only — AI sessions capped at 60 points.
 */
export async function incrementAISessions(
  anonymousId: string,
  investorStyle?: string,
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newSessions = (row.ai_sessions || 0) + 1;

  const totalScore = await computeAndWriteScore(
    supabase,
    anonymousId,
    { ...row, ai_sessions: newSessions },
    { ai_sessions: newSessions },
    { investorStyle },
  );

  console.log(
    `[gamification] AI session #${newSessions} → score=${totalScore}`,
  );

  return { success: true, totalScore, milestonesEarned: row.milestones_earned || 0 };
}

/**
 * Recalculate score after streak sync or portfolio update.
 * Also checks Steady Hands milestone if heldThroughDrawdown is provided.
 */
export async function recalculateScore(
  anonymousId: string,
  investorStyle?: string,
  /** Optional: portfolio data for Construction pillar */
  positionCount?: number,
  maxPositionPct?: number,
  diversificationScore?: number,
  /** Optional: drawdown resilience check */
  heldThroughDrawdown?: boolean,
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const config = await getGamificationConfig();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  // Count milestones
  const { count: milestoneCount } = await (supabase as any)
    .from('milestones')
    .select('*', { count: 'exact', head: true })
    .eq('anonymous_id', anonymousId);

  const newMilestones = milestoneCount || 0;
  const newDiversification =
    diversificationScore ?? row.diversification_score ?? 0;

  const totalScore = await computeAndWriteScore(
    supabase,
    anonymousId,
    {
      ...row,
      diversification_score: newDiversification,
    },
    {
      milestones_earned: newMilestones,
      diversification_score: newDiversification,
    },
    {
      investorStyle,
      positionCount,
      maxPositionPct,
      heldThroughDrawdown,
    },
  );

  // ── Milestone checks ─────────────────────────────────────
  let milestoneAwarded = false;

  if (heldThroughDrawdown) {
    const steadyMilestone = await checkAndAwardSteadyHands(
      supabase, anonymousId, heldThroughDrawdown,
    );
    if (steadyMilestone) milestoneAwarded = true;
  }

  if (
    positionCount !== undefined &&
    maxPositionPct !== undefined &&
    positionCount >= 5
  ) {
    const builtMilestone = await checkAndAwardWellBuilt(
      supabase, anonymousId, positionCount, newDiversification, maxPositionPct,
      {
        positions: config.milestones.well_built_positions,
        diversification: config.milestones.well_built_diversification,
        maxPosition: config.milestones.well_built_max_position_pct,
      },
    );
    if (builtMilestone) milestoneAwarded = true;
  }

  return {
    success: true,
    totalScore,
    milestonesEarned: newMilestones + (milestoneAwarded ? 1 : 0),
  };
}

/**
 * Fetch investor score (raw DB row) for an anonymous user.
 */
export async function getInvestorScore(
  anonymousId: string,
): Promise<any | null> {
  if (!anonymousId) return null;

  const supabase = createServerClient();

  try {
    const { data, error } = await (supabase as any)
      .from('investor_scores')
      .select('*')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (error) {
      console.error('[gamification] Fetch score error:', error.message);
      return null;
    }

    return data;
  } catch (err: any) {
    console.error('[gamification] Fetch score exception:', err.message);
    return null;
  }
}

// ─── Learning XP ─────────────────────────────────────────────

/**
 * Award learning engagement when user completes a Learning Moment.
 * Now uses deep_engagement_count for the Understanding pillar.
 *
 * @param anonymousId  The anonymous session ID
 * @param _xpAmount    Kept for API compatibility, unused in new formula
 * @param isDeep       Whether the engagement had depth (time/follow-up)
 */
export async function addLearningXP(
  anonymousId: string,
  _xpAmount: number = 0,
  isDeep: boolean = false,
  investorStyle?: string,
): Promise<{ success: boolean; newScore?: number; milestoneAwarded?: string }> {
  if (!anonymousId) return { success: false };

  const supabase = createServerClient();

  try {
    const config = await getGamificationConfig();
    const row = await getOrCreateScore(anonymousId);
    if (!row) return { success: false };

    const newLearningCount = (row.learning_count || 0) + 1;
    const newDeepCount = (row.deep_engagement_count || 0) + (isDeep ? 1 : 0);

    const extraUpdates: Record<string, any> = {
      learning_count: newLearningCount,
      deep_engagement_count: newDeepCount,
    };

    const totalScore = await computeAndWriteScore(
      supabase,
      anonymousId,
      {
        ...row,
        learning_count: newLearningCount,
        deep_engagement_count: newDeepCount,
      },
      extraUpdates,
      {
        investorStyle,
        deepEngagementCount: newDeepCount,
      },
    );

    // ── Milestone: Student of the Game ────────────────────
    let milestoneAwarded: string | undefined;
    const studentMilestone = await checkAndAwardStudentOfTheGame(
      supabase, anonymousId, newLearningCount, newDeepCount,
      {
        learning: config.milestones.student_learning_count,
        deep: config.milestones.student_deep_count,
      },
    );
    if (studentMilestone) {
      milestoneAwarded = MILESTONE.STUDENT_OF_THE_GAME;
    }

    console.log(
      `[gamification] Learning #${newLearningCount}` +
        ` (deep=${newDeepCount})` +
        ` → score=${totalScore}` +
        (milestoneAwarded ? ` 🏆 ${milestoneAwarded}` : ''),
    );

    return { success: true, newScore: totalScore, milestoneAwarded };
  } catch (err: any) {
    console.error('[gamification] addLearningXP exception:', err.message);
    return { success: false };
  }
}
