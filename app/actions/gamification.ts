// ─── Gamification: Server Actions ────────────────────────────
// ALL gamification writes go through these server actions.
// Uses SUPABASE_SERVICE_ROLE_KEY — never reaches the browser.
//
// This file must ONLY be imported in:
//   - API routes (app/api/gamification/*)
//   - Server components
//
// NEVER import this in client components directly.
// Client components call API routes instead.

import { createServerClient } from '@/lib/supabase';
import { calculateInvestorScore } from '@/lib/investor-score/calculate';
import { inferTradeStyle } from '@/lib/investor-score/calculate';
import type { ScoreMetrics } from '@/lib/investor-score/calculate';

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
}

// ─── Defaults ─────────────────────────────────────────────────
// These are used ONLY when no real data exists yet.
// Once a trade provides real portfolio data, these get replaced.

const STYLE_CONSISTENCY_DEFAULT = 50;
const RISK_ADHERENCE_DEFAULT = 70;
const DIVERSIFICATION_DEFAULT = 50;
const LEARNING_COUNT_DEFAULT = 0;

// ─── Milestone Awarding ──────────────────────────────────────

/**
 * Award a milestone to an anonymous user.
 *
 * Idempotent — if the milestone is already awarded for this
 * anonymous_id, returns `{ awarded: false }` (409 Conflict).
 */
export async function awardMilestone(
  anonymousId: string,
  milestoneKey: string
): Promise<AwardMilestoneResult> {
  if (!anonymousId || !milestoneKey) {
    return { awarded: false, milestoneKey, reason: 'Missing params' };
  }

  const supabase = createServerClient();

  try {
    const { error } = await (supabase as any)
      .from('milestones')
      .upsert(
        {
          anonymous_id: anonymousId,
          milestone_key: milestoneKey,
          milestone_label: milestoneKey,
          awarded_at: new Date().toISOString(),
        },
        { onConflict: 'anonymous_id,milestone_key', ignoreDuplicates: true }
      );

    if (error) {
      // 23505 = unique violation (already awarded)
      if (error.code === '23505') {
        return { awarded: false, milestoneKey, reason: 'Already awarded' };
      }
      console.error('[gamification] Award error:', error.message);
      return { awarded: false, milestoneKey, reason: error.message };
    }

    console.log(`[gamification] Awarded ${milestoneKey} to ${anonymousId.slice(0, 8)}...`);
    return { awarded: true, milestoneKey };
  } catch (err: any) {
    console.error('[gamification] Award exception:', err.message);
    return { awarded: false, milestoneKey, reason: err.message };
  }
}

/**
 * Fetch all milestones for an anonymous user.
 */
export async function getMilestones(
  anonymousId: string
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
 * Get or create an investor score row for an anonymous user.
 */
async function getOrCreateScore(anonymousId: string): Promise<any> {
  const supabase = createServerClient();

  const { data: existing } = await (supabase as any)
    .from('investor_scores')
    .select('*')
    .eq('anonymous_id', anonymousId)
    .maybeSingle();

  if (existing) return existing;

  // Create new score row with all skill-signal columns
  const { data: created, error } = await (supabase as any)
    .from('investor_scores')
    .insert({
      anonymous_id: anonymousId,
      baskets_created: 0,
      trades_executed: 0,
      ai_sessions: 0,
      milestones_earned: 0,
      total_score: 0,
      style_consistency: STYLE_CONSISTENCY_DEFAULT,
      risk_adherence: RISK_ADHERENCE_DEFAULT,
      diversification_score: DIVERSIFICATION_DEFAULT,
      learning_count: LEARNING_COUNT_DEFAULT,
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

/**
 * Compute the canonical investor score using calculateInvestorScore.
 * This is the SINGLE source of truth — all score writes go through this.
 *
 * Now includes: diversification_score and learning_count from the DB row
 * (populated by real portfolio analysis at trade time).
 */
async function computeAndWriteScore(
  supabase: any,
  anonymousId: string,
  row: any,
  extraUpdates: Record<string, any> = {}
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
    // Non-fatal: just use 0
  }

  const metrics: ScoreMetrics = {
    baskets_created: row.baskets_created || 0,
    trades_executed: row.trades_executed || 0,
    ai_sessions: row.ai_sessions || 0,
    current_streak: currentStreak,
    style_consistency: row.style_consistency ?? STYLE_CONSISTENCY_DEFAULT,
    risk_adherence: row.risk_adherence ?? RISK_ADHERENCE_DEFAULT,
    diversification_score: row.diversification_score ?? DIVERSIFICATION_DEFAULT,
    learning_count: row.learning_count ?? LEARNING_COUNT_DEFAULT,
  };

  const result = calculateInvestorScore(metrics);

  await supabase
    .from('investor_scores')
    .update({
      total_score: result.score,
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...extraUpdates,
    })
    .eq('anonymous_id', anonymousId);

  return result.score;
}

/**
 * Increment baskets_created and recalculate total score.
 */
export async function incrementBasketsCreated(
  anonymousId: string
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newBaskets = row.baskets_created + 1;

  // Apply the increment to a cloned row so computeAndWriteScore sees it
  const updatedRow = { ...row, baskets_created: newBaskets };
  const totalScore = await computeAndWriteScore(supabase, anonymousId, updatedRow, {
    baskets_created: newBaskets,
  });

  return { success: true, totalScore, milestonesEarned: row.milestones_earned };
}

/**
 * Increment trades_executed and recalculate total score.
 *
 * FIX 1: Real style consistency via inferTradeStyle() + running average.
 * The client passes actual trade characteristics (not the declared style),
 * and we infer the trade's real style, then compute a running average
 * of (matching trades) / (total trades) × 100.
 *
 * FIX 2: Accepts portfolio-derived risk_adherence and diversification_score
 * from the client (computed at trade time when portfolio data is available).
 */
export async function incrementTradesExecuted(
  anonymousId: string,
  /** Actual trade characteristics for inferTradeStyle() */
  tradeAssetType?: string,
  tradeSector?: string,
  tradeHoldingDays?: number,
  basketStrategy?: string,
  /** User's declared investor style for comparison */
  investorStyle?: string,
  /** Portfolio-derived skill metrics (computed client-side from positions) */
  riskAdherence?: number,
  diversificationScore?: number
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newTrades = row.trades_executed + 1;
  const prevTrades = row.trades_executed || 0;

  // ── FIX 1: Real style consistency ────────────────────────
  // Infer the trade's actual style from its characteristics
  const inferredStyle = inferTradeStyle({
    assetType: tradeAssetType,
    holdingDays: tradeHoldingDays,
    basketStrategy,
    sector: tradeSector,
  });

  // Compare inferred style to declared investor style
  const thisTradeMatches = investorStyle && inferredStyle === investorStyle;
  const prevMatches = row.matching_trades || 0;
  const newMatches = prevMatches + (thisTradeMatches ? 1 : 0);

  // Running average: (matching / total) × 100
  const styleConsistency = prevTrades > 0 || thisTradeMatches
    ? Math.round((newMatches / newTrades) * 100)
    : STYLE_CONSISTENCY_DEFAULT;

  // ── FIX 2 & 3: Skill metrics from portfolio data ─────────
  // These are computed client-side at trade time (when we have positions/account data)
  // and passed through. If not provided, keep existing values.
  const newRiskAdherence = riskAdherence ?? row.risk_adherence ?? RISK_ADHERENCE_DEFAULT;
  const newDiversification = diversificationScore ?? row.diversification_score ?? DIVERSIFICATION_DEFAULT;

  const updatedRow = {
    ...row,
    trades_executed: newTrades,
    style_consistency: styleConsistency,
    matching_trades: newMatches,
    risk_adherence: newRiskAdherence,
    diversification_score: newDiversification,
  };

  const totalScore = await computeAndWriteScore(supabase, anonymousId, updatedRow, {
    trades_executed: newTrades,
    style_consistency: styleConsistency,
    matching_trades: newMatches,
    risk_adherence: newRiskAdherence,
    diversification_score: newDiversification,
  });

  console.log(
    `[gamification] Trade #${newTrades}: inferred=${inferredStyle}` +
    ` declared=${investorStyle} match=${thisTradeMatches}` +
    ` consistency=${styleConsistency}% risk=${newRiskAdherence} divers=${newDiversification}` +
    ` score=${totalScore}`
  );

  return { success: true, totalScore, milestonesEarned: row.milestones_earned };
}

/**
 * Increment ai_sessions and recalculate total score.
 */
export async function incrementAISessions(
  anonymousId: string
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newSessions = row.ai_sessions + 1;

  const updatedRow = { ...row, ai_sessions: newSessions };
  const totalScore = await computeAndWriteScore(supabase, anonymousId, updatedRow, {
    ai_sessions: newSessions,
  });

  return { success: true, totalScore, milestonesEarned: row.milestones_earned };
}

/**
 * Recalculate investor score after milestone awarded or streak sync.
 */
export async function recalculateScore(
  anonymousId: string
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  // Count milestones
  const { count: milestoneCount } = await (supabase as any)
    .from('milestones')
    .select('*', { count: 'exact', head: true })
    .eq('anonymous_id', anonymousId);

  const newMilestones = milestoneCount || 0;

  const totalScore = await computeAndWriteScore(supabase, anonymousId, row, {
    milestones_earned: newMilestones,
  });

  return { success: true, totalScore, milestonesEarned: newMilestones };
}

/**
 * Fetch investor score for an anonymous user.
 */
export async function getInvestorScore(
  anonymousId: string
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

// ─── Learning XP → Formula Integration (FIX 4) ──────────────

/**
 * Award learning engagement when user completes a Learning Moment.
 *
 * FIX 4: Instead of adding flat XP on top of the formula score,
 * this now increments a learning_count counter and recalculates
 * the score via the formula (learning_count × 3 points).
 * This gives consistent write semantics — all components flow
 * through computeAndWriteScore.
 *
 * Existing accounts: any previously-awarded flat XP is preserved
 * in total_score. The first post-migration learning completion
 * will recalculate via the formula, which reads learning_count
 * (starting at 0 or whatever was migrated). The existing total_score
 * may DIP slightly after the first recalculation (since flat XP
 * bonuses are removed), but subsequent activity will push it back
 * up via the formula. This is acceptable: the old flat-XP approach
 * was disconnected from the formula; the new approach is correct.
 */
export async function addLearningXP(
  anonymousId: string,
  _xpAmount: number // kept for API compatibility, unused in new formula
): Promise<{ success: boolean; newScore?: number }> {
  if (!anonymousId) return { success: false };

  const supabase = createServerClient();

  try {
    const row = await getOrCreateScore(anonymousId);
    if (!row) return { success: false };

    // FIX 4: Increment learning_count and recompute via formula.
    // No more flat XP addition — learning is a weighted formula input.
    const newCount = (row.learning_count || 0) + 1;

    const updatedRow = { ...row, learning_count: newCount };
    const totalScore = await computeAndWriteScore(supabase, anonymousId, updatedRow, {
      learning_count: newCount,
    });

    console.log(
      `[gamification] Learning #${newCount} → formula score=${totalScore}`
    );

    return { success: true, newScore: totalScore };
  } catch (err: any) {
    console.error('[gamification] addLearningXP exception:', err.message);
    return { success: false };
  }
}
