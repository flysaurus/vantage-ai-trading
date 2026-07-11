// ─── Investor Score: Server Actions ─────────────────────────
// Server-side actions for reading/writing investor scores.
// Uses SUPABASE_SERVICE_ROLE_KEY — never reaches the browser.
//
// Import in: API routes, server components only.

import { createServerClient } from '@/lib/supabase';
import { calculateInvestorScore, getLevel, getLevelProgress, getNextLevelThreshold } from '@/lib/investor-score/calculate';
import type { ScoreMetrics, ScoreResult } from '@/lib/investor-score/calculate';

// ─── Types ────────────────────────────────────────────────────

/** Raw activity counts stored in DB, exposed for stat displays. */
export interface RawScoreMetrics {
  trades_executed: number;
  matching_trades: number;
  ai_sessions: number;
  current_streak: number;
  learning_count: number;
  deep_engagement_count: number;
  diversification_score: number;
}

export interface ScoreWithMetrics {
  score: ScoreResult;
  metrics: RawScoreMetrics;
}

// ─── Get Current Score ───────────────────────────────────────

/**
 * Fetch and compute the current investor score for a user.
 * Combines data from investor_scores + streaks.
 * Now uses real risk_adherence and diversification_score from the DB
 * (computed at trade time from portfolio data), not trade-count proxies.
 */
export async function getMyScore(anonymousId: string): Promise<ScoreResult | null> {
  const result = await getMyScoreWithMetrics(anonymousId);
  return result?.score ?? null;
}

/**
 * Same as getMyScore but also returns raw activity counts
 * for stat displays (baskets, trades, AI chats, learning, streak days).
 */
export async function getMyScoreWithMetrics(anonymousId: string): Promise<ScoreWithMetrics | null> {
  if (!anonymousId) return null;

  const supabase = createServerClient();

  try {
    const supabase = createServerClient();

    let scoresRes;
    try {
      scoresRes = await (supabase as any)
        .from('investor_scores')
        .select('*')
        .eq('anonymous_id', anonymousId)
        .maybeSingle();
    } catch (e: any) {
      console.error('[investor-score] investor_scores query failed:', e.message);
      throw new Error('investor_scores_query: ' + e.message);
    }

    let streakRes;
    try {
      streakRes = await (supabase as any)
        .from('streaks')
        .select('current_streak')
        .eq('anonymous_id', anonymousId)
        .maybeSingle();
    } catch (e: any) {
      console.error('[investor-score] streaks query failed:', e.message);
      throw new Error('streaks_query: ' + e.message);
    }

    const scores = scoresRes.data;
    const streak = streakRes.data;

    const rawMetrics: RawScoreMetrics = {
      trades_executed: scores?.trades_executed || 0,
      matching_trades: scores?.matching_trades || 0,
      ai_sessions: scores?.ai_sessions || 0,
      current_streak: streak?.current_streak || 0,
      learning_count: scores?.learning_count || 0,
      deep_engagement_count: scores?.deep_engagement_count || 0,
      diversification_score: scores?.diversification_score || 0,
    };

    // Four-pillar ScoreMetrics (no generous defaults — new accounts score 0)
    const metrics: ScoreMetrics = {
      trades_executed: rawMetrics.trades_executed,
      matching_trades: rawMetrics.matching_trades,
      held_through_drawdown: false, // computed at check-time
      learning_count: rawMetrics.learning_count,
      deep_engagement_count: rawMetrics.deep_engagement_count,
      diversification_score: rawMetrics.diversification_score,
      position_count: 0, // requires portfolio data
      max_position_pct: 0,
      current_streak: rawMetrics.current_streak,
      ai_sessions: rawMetrics.ai_sessions,
    };

    let profile: any = null;
    try {
      const profileRes = await (supabase as any)
        .from('anonymous_profiles')
        .select('investor_style')
        .eq('anonymous_id', anonymousId)
        .maybeSingle();
      profile = profileRes.data;
    } catch {
      // anonymous_profiles table may not exist — non-fatal
    }

    return {
      score: calculateInvestorScore(metrics, profile?.investor_style),
      metrics: rawMetrics,
    };
  } catch (err: any) {
    console.error('[investor-score] getMyScoreWithMetrics error:', err.message);
    throw err; // Propagate to route handler for detailed error response
  }
}

// ─── Update Score Metric ────────────────────────────────────

type ScoreMetricKey = keyof ScoreMetrics;

/**
 * Increment a single score metric atomically.
 * NOTE: prefer gamification.ts actions for standard updates.
 * This is a low-level helper for legacy/edge cases.
 */
export async function updateScoreMetric(
  anonymousId: string,
  metric: ScoreMetricKey,
  increment: number
): Promise<void> {
  if (!anonymousId) return;

  // Map ScoreMetricKey to actual column name
  const columnMap: Record<string, string> = {
    trades_executed: 'trades_executed',
    matching_trades: 'matching_trades',
    ai_sessions: 'ai_sessions',
    current_streak: 'current_streak',
    learning_count: 'learning_count',
    deep_engagement_count: 'deep_engagement_count',
    diversification_score: 'diversification_score',
    position_count: 'position_count',
    max_position_pct: 'max_position_pct',
    held_through_drawdown: 'held_through_drawdown',
  };

  const column = columnMap[metric];
  if (!column || column === 'current_streak') {
    // Computed from other tables, not stored directly
    return;
  }

  const supabase = createServerClient();

  try {
    const { data: existing } = await (supabase as any)
      .from('investor_scores')
      .select(column)
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (existing) {
      const newVal = Math.max(0, (existing[column] || 0) + increment);
      await (supabase as any)
        .from('investor_scores')
        .update({
          [column]: newVal,
          updated_at: new Date().toISOString(),
        })
        .eq('anonymous_id', anonymousId);
    } else {
      await (supabase as any)
        .from('investor_scores')
        .insert({
          anonymous_id: anonymousId,
          [column]: Math.max(0, increment),
        });
    }
  } catch (err: any) {
    console.error('[investor-score] updateScoreMetric error:', err.message);
  }
}
