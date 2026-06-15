// ─── Investor Score: Weekly Snapshots ────────────────────────
// Takes weekly snapshots of the investor score and appends
// them to a score_history JSONB array in investor_scores.
//
// Called by the weekly cron job (/api/cron/investor-score).

import { createServerClient } from '@/lib/supabase';
import { calculateInvestorScore, getLevel } from './calculate';
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

    // Calculate score
    const metrics: ScoreMetrics = {
      baskets_created: scores.baskets_created || 0,
      trades_executed: scores.trades_executed || 0,
      ai_sessions: scores.ai_sessions || 0,
      current_streak: streak?.current_streak || 0,
      // Use stored consistency or default
      style_consistency: scores.style_consistency || 50,
      // Estimate risk adherence from available data
      risk_adherence: estimateRiskAdherence(profile?.risk_tolerance, scores),
    };

    const result = calculateInvestorScore(metrics);

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
  // Without full portfolio data in the scores table, provide a baseline
  // based on available signal: if user has style_consistency score, they're
  // likely aligned. Otherwise estimate from activity patterns.

  if (scores.style_consistency && scores.style_consistency > 0) {
    // User has style data — assume risk adherence correlates with activity
    const activityBonus = Math.min(50, (scores.trades_executed || 0) * 3);
    return Math.min(100, 50 + activityBonus);
  }

  // Conservative users with fewer trades are considered more risk-adherent
  // (they're deliberate, not impulsive)
  if (riskTolerance === 'conservative') {
    return scores.trades_executed > 10 ? 70 : 85;
  }
  if (riskTolerance === 'aggressive') {
    return scores.trades_executed > 5 ? 80 : 60;
  }

  // Default moderate
  return 70;
}
