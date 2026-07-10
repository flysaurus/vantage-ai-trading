// ─── Investor Score: Weekly Snapshots ────────────────────────
// Takes weekly snapshots of the investor score and appends
// them to a score_history JSONB array in investor_scores.
//
// Called by the weekly cron job (/api/cron/investor-score).

import { createServerClient } from '@/lib/supabase';
import { calculateInvestorScore } from './calculate';
import type { ScoreMetrics } from './calculate';

// ─── Types ────────────────────────────────────────────────────

export interface ScoreSnapshot {
  date: string;   // ISO 8601
  score: number;
  level: string;
}

const MAX_SNAPSHOTS = 52; // 1 year of weekly snapshots

// ─── Public API ───────────────────────────────────────────────

/**
 * Take a weekly snapshot of the investor score for a single user.
 *
 * 1. Fetches current investor_scores + streaks + milestones
 * 2. Calculates the current investor score
 * 3. Appends to score_history JSONB array (last 52)
 * 4. Upserts investor_scores
 */
export async function takeWeeklySnapshot(anonymousId: string): Promise<void> {
  if (!anonymousId) {
    console.warn('[investor-score/snapshot] No anonymousId provided');
    return;
  }

  const supabase = createServerClient();

  try {
    // Fetch current data
    const { data: scores } = await (supabase as any)
      .from('investor_scores')
      .select('*')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    const { data: streak } = await (supabase as any)
      .from('streaks')
      .select('current_streak')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    const { data: profile } = await (supabase as any)
      .from('anonymous_profiles')
      .select('investor_style, risk_tolerance')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (!scores) {
      console.log(`[investor-score/snapshot] No scores row for ${anonymousId.slice(0, 8)}...`);
      return;
    }

    // Calculate score with four-pillar formula
    const metrics: ScoreMetrics = {
      trades_executed: scores.trades_executed || 0,
      matching_trades: scores.matching_trades || 0,
      held_through_drawdown: false, // computed at check-time, not stored in DB
      learning_count: scores.learning_count || 0,
      deep_engagement_count: scores.deep_engagement_count || 0,
      diversification_score: scores.diversification_score || 0,
      position_count: 0, // requires portfolio data — omitted for weekly snapshot
      max_position_pct: 0,
      current_streak: streak?.current_streak || 0,
      ai_sessions: scores.ai_sessions || 0,
    };

    const investorStyle = profile?.investor_style;
    const result = calculateInvestorScore(metrics, investorStyle);

    // Build snapshot
    const snapshot: ScoreSnapshot = {
      date: new Date().toISOString(),
      score: result.score,
      level: result.level,
    };

    // Get existing history
    const existingHistory: ScoreSnapshot[] = Array.isArray(scores.score_history)
      ? scores.score_history
      : [];

    // Append and trim
    const newHistory = [...existingHistory, snapshot].slice(-MAX_SNAPSHOTS);

    // Upsert
    await (supabase as any)
      .from('investor_scores')
      .upsert(
        {
          anonymous_id: anonymousId,
          score_history: newHistory,
          last_score: result.score,
          last_level: result.level,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'anonymous_id' }
      );

    console.log(
      `[investor-score/snapshot] ${anonymousId.slice(0, 8)}... → ${result.score} (${result.level})`
    );
  } catch (err: any) {
    console.error(`[investor-score/snapshot] Error for ${anonymousId.slice(0, 8)}...:`, err.message);
  }
}

/**
 * Get score history for an anonymous user.
 * Returns an array of { date, score, level } snapshots.
 */
export async function getScoreHistory(
  anonymousId: string
): Promise<ScoreSnapshot[]> {
  if (!anonymousId) return [];

  const supabase = createServerClient();

  try {
    const { data } = await (supabase as any)
      .from('investor_scores')
      .select('score_history')
      .eq('anonymous_id', anonymousId)
      .maybeSingle();

    if (!data || !Array.isArray(data.score_history)) return [];

    return data.score_history as ScoreSnapshot[];
  } catch (err: any) {
    console.error('[investor-score/snapshot] Fetch history error:', err.message);
    return [];
  }
}

/**
 * Fetch all active investor_scores records for batch snapshotting.
 */
export async function getAllActiveScores(): Promise<Array<{ anonymous_id: string }>> {
  const supabase = createServerClient();

  try {
    const { data } = await (supabase as any)
      .from('investor_scores')
      .select('anonymous_id')
      .not('anonymous_id', 'is', null);

    return (data || []) as Array<{ anonymous_id: string }>;
  } catch (err: any) {
    console.error('[investor-score/snapshot] Fetch all error:', err.message);
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function estimateRiskAdherence(
  riskTolerance: string | undefined,
  scores: any
): number {
  // Fallback estimate when no real portfolio data is available
  // (snapshot cron runs without portfolio context).
  // Real risk_adherence is stored at trade time from calculateRiskAdherence().

  if (scores.style_consistency && scores.style_consistency > 0) {
    const activityBonus = Math.min(50, (scores.trades_executed || 0) * 3);
    return Math.min(100, 50 + activityBonus);
  }

  if (riskTolerance === 'conservative') {
    return scores.trades_executed > 10 ? 70 : 85;
  }
  if (riskTolerance === 'aggressive') {
    return scores.trades_executed > 5 ? 80 : 60;
  }

  return 70;
}
