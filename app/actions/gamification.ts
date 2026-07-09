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

// ─── Style Consistency / Risk Adherence Defaults ──────────────

/** 0-100: % of trades matching investor style. 100 = fully consistent. */
const STYLE_CONSISTENCY_MATCH = 100;
/** Default when no data yet (neutral). */
const STYLE_CONSISTENCY_DEFAULT = 50;
/** Default risk adherence (moderate). */
const RISK_ADHERENCE_DEFAULT = 70;

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

  // Create new score row
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
    risk_adherence: RISK_ADHERENCE_DEFAULT,
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
 */
export async function incrementTradesExecuted(
  anonymousId: string,
  tradeStyle?: string,
  investorStyle?: string
): Promise<UpdateScoreResult> {
  const supabase = createServerClient();
  const row = await getOrCreateScore(anonymousId);
  if (!row) return { success: false, totalScore: 0, milestonesEarned: 0 };

  const newTrades = row.trades_executed + 1;

  // Style consistency: 0-100 scale (100 = fully consistent with declared style)
  let styleConsistency = row.style_consistency ?? STYLE_CONSISTENCY_DEFAULT;
  if (tradeStyle && investorStyle && tradeStyle === investorStyle) {
    // If all trades so far matched the declared style, score as fully consistent
    styleConsistency = STYLE_CONSISTENCY_MATCH;
  }

  const updatedRow = {
    ...row,
    trades_executed: newTrades,
    style_consistency: styleConsistency,
  };
  const totalScore = await computeAndWriteScore(supabase, anonymousId, updatedRow, {
    trades_executed: newTrades,
    style_consistency: styleConsistency,
  });

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

// ─── Learning XP ────────────────────────────────────────────

/**
 * Award learning XP when user taps "Got it" on a Learning Moment card.
 * Increments total_score by xpAmount on investor_scores.
 * Used by the learning system (Phase 4 Prompt 5).
 */
export async function addLearningXP(
  anonymousId: string,
  xpAmount: number
): Promise<{ success: boolean; newScore?: number }> {
  if (!anonymousId || xpAmount <= 0) return { success: false };

  const supabase = createServerClient();

  try {
    // Ensure a score row exists
    const row = await getOrCreateScore(anonymousId);
    if (!row) return { success: false };

    // Compute the canonical score as baseline, then add learning XP on top.
    // Learning XP is additive: conceptual understanding earns bonus points
    // that stack on top of activity-based scoring.
    const baseScore = row.total_score > 0
      ? row.total_score
      : (await (async () => {
          // If total_score is 0, compute it fresh (first time)
          let s = 0;
          try {
            let currentStreak = 0;
            const { data: streak } = await (supabase as any)
              .from('streaks')
              .select('current_streak')
              .eq('anonymous_id', anonymousId)
              .maybeSingle();
            currentStreak = streak?.current_streak || 0;

            const metrics: ScoreMetrics = {
              baskets_created: row.baskets_created || 0,
              trades_executed: row.trades_executed || 0,
              ai_sessions: row.ai_sessions || 0,
              current_streak: currentStreak,
              style_consistency: row.style_consistency ?? STYLE_CONSISTENCY_DEFAULT,
              risk_adherence: RISK_ADHERENCE_DEFAULT,
            };
            s = calculateInvestorScore(metrics).score;
          } catch {
            s = 0;
          }
          return s;
        }))();

    const newScore = baseScore + xpAmount;

    const { error: updateErr } = await (supabase as any)
      .from('investor_scores')
      .update({ total_score: newScore, updated_at: new Date().toISOString() })
      .eq('anonymous_id', anonymousId);

    if (updateErr) {
      console.error('[gamification] addLearningXP update error:', updateErr.message);
      return { success: false };
    }

    return { success: true, newScore };
  } catch (err: any) {
    console.error('[gamification] addLearningXP exception:', err.message);
    return { success: false };
  }
}
