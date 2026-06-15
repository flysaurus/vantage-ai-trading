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

// ─── Scoring Constants ───────────────────────────────────────

const POINTS_PER_BASKET = 10;
const POINTS_PER_TRADE = 5;
const POINTS_PER_AI_SESSION = 3;
const STYLE_CONSISTENCY_SCORE = 20;
const POINTS_PER_MILESTONE = 25;
const MAX_STREAK_BONUS = 35; // 5 per day × 7 max days

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
  const basketPoints = newBaskets * POINTS_PER_BASKET;
  const tradePoints = row.trades_executed * POINTS_PER_TRADE;
  const aiPoints = row.ai_sessions * POINTS_PER_AI_SESSION;
  const milestonePoints = row.milestones_earned * POINTS_PER_MILESTONE;
  const totalScore = basketPoints + tradePoints + aiPoints + milestonePoints + row.style_consistency + row.streak_bonus;

  await (supabase as any)
    .from('investor_scores')
    .update({
      baskets_created: newBaskets,
      total_score: totalScore,
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('anonymous_id', anonymousId);

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
  const tradePoints = newTrades * POINTS_PER_TRADE;
  const basketPoints = row.baskets_created * POINTS_PER_BASKET;
  const aiPoints = row.ai_sessions * POINTS_PER_AI_SESSION;
  const milestonePoints = row.milestones_earned * POINTS_PER_MILESTONE;

  // Style consistency check
  let styleConsistency = row.style_consistency;
  if (tradeStyle && investorStyle && tradeStyle === investorStyle) {
    styleConsistency = STYLE_CONSISTENCY_SCORE;
  }

  const totalScore = basketPoints + tradePoints + aiPoints + milestonePoints + styleConsistency + row.streak_bonus;

  await (supabase as any)
    .from('investor_scores')
    .update({
      trades_executed: newTrades,
      style_consistency: styleConsistency,
      total_score: totalScore,
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('anonymous_id', anonymousId);

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
  const aiPoints = newSessions * POINTS_PER_AI_SESSION;
  const basketPoints = row.baskets_created * POINTS_PER_BASKET;
  const tradePoints = row.trades_executed * POINTS_PER_TRADE;
  const milestonePoints = row.milestones_earned * POINTS_PER_MILESTONE;
  const totalScore = basketPoints + tradePoints + aiPoints + milestonePoints + row.style_consistency + row.streak_bonus;

  await (supabase as any)
    .from('investor_scores')
    .update({
      ai_sessions: newSessions,
      total_score: totalScore,
      last_activity: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('anonymous_id', anonymousId);

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
  const basketPoints = row.baskets_created * POINTS_PER_BASKET;
  const tradePoints = row.trades_executed * POINTS_PER_TRADE;
  const aiPoints = row.ai_sessions * POINTS_PER_AI_SESSION;
  const milestonePoints = newMilestones * POINTS_PER_MILESTONE;

  // Fetch streak for bonus
  let streakBonus = row.streak_bonus;
  try {
    const { data: streak } = await (supabase as any)
      .from('streaks')
      .select('current_streak')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();
    if (streak) {
      streakBonus = Math.min(streak.current_streak * 5, MAX_STREAK_BONUS);
    }
  } catch {
    // Keep existing streak bonus on error
  }

  const totalScore = basketPoints + tradePoints + aiPoints + milestonePoints + row.style_consistency + streakBonus;

  await (supabase as any)
    .from('investor_scores')
    .update({
      milestones_earned: newMilestones,
      streak_bonus: streakBonus,
      total_score: totalScore,
      updated_at: new Date().toISOString(),
    })
    .eq('anonymous_id', anonymousId);

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
    // Ensure row exists
    await (supabase as any)
      .from('investor_scores')
      .upsert(
        { anonymous_id: anonymousId, total_score: 0 },
        { onConflict: 'anonymous_id' }
      );

    // Fetch current score
    const { data: current, error: fetchErr } = await (supabase as any)
      .from('investor_scores')
      .select('total_score')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (fetchErr) {
      console.error('[gamification] addLearningXP fetch error:', fetchErr.message);
      return { success: false };
    }

    const newScore = (current?.total_score || 0) + xpAmount;

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
