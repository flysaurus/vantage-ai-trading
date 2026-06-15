// ─── Investor Score: Server Actions ─────────────────────────
// Server-side actions for reading/writing investor scores.
// Uses SUPABASE_SERVICE_ROLE_KEY — never reaches the browser.
//
// Import in: API routes, server components only.

import { createServerClient } from '@/lib/supabase';
import { calculateInvestorScore, getLevel, getLevelProgress, getNextLevelThreshold } from '@/lib/investor-score/calculate';
import type { ScoreMetrics, ScoreResult } from '@/lib/investor-score/calculate';

// ─── Get Current Score ───────────────────────────────────────

/**
 * Fetch and compute the current investor score for a user.
 * Combines data from investor_scores + streaks + anonymous_profiles.
 */
export async function getMyScore(anonymousId: string): Promise<ScoreResult | null> {
  if (!anonymousId) return null;

  const supabase = createServerClient();

  try {
    // Fetch all needed data in parallel
    const [scoresRes, streakRes, profileRes] = await Promise.all([
      (supabase as any)
        .from('investor_scores')
        .select('*')
        .eq('anonymous_id', anonymousId)
        .maybeSingle(),
      (supabase as any)
        .from('streaks')
        .select('current_streak')
        .eq('anonymous_id', anonymousId)
        .maybeSingle(),
      (supabase as any)
        .from('anonymous_profiles')
        .select('investor_style, risk_tolerance')
        .eq('anonymous_id', anonymousId)
        .maybeSingle(),
    ]);

    const scores = scoresRes.data;
    const streak = streakRes.data;
    const profile = profileRes.data;

    if (!scores) {
      // No scores row yet — return minimal result
      return calculateInvestorScore({
        baskets_created: 0,
        trades_executed: 0,
        ai_sessions: 0,
        current_streak: 0,
        style_consistency: 50,
        risk_adherence: 50,
      });
    }

    const metrics: ScoreMetrics = {
      baskets_created: scores.baskets_created || 0,
      trades_executed: scores.trades_executed || 0,
      ai_sessions: scores.ai_sessions || 0,
      current_streak: streak?.current_streak || 0,
      style_consistency: scores.style_consistency || 50,
      risk_adherence: estimateRiskAdherence(profile?.risk_tolerance, scores),
    };

    return calculateInvestorScore(metrics);
  } catch (err: any) {
    console.error('[investor-score] getMyScore error:', err.message);
    return null;
  }
}

// ─── Update Score Metric ────────────────────────────────────

type ScoreMetricKey = keyof ScoreMetrics;

/**
 * Increment a single score metric atomically.
 * Handles upsert of investor_scores row.
 */
export async function updateScoreMetric(
  anonymousId: string,
  metric: ScoreMetricKey,
  increment: number
): Promise<void> {
  if (!anonymousId) return;

  // Map ScoreMetricKey to actual column name
  const columnMap: Record<string, string> = {
    baskets_created: 'baskets_created',
    trades_executed: 'trades_executed',
    ai_sessions: 'ai_sessions',
    current_streak: 'current_streak',
    style_consistency: 'style_consistency',
    risk_adherence: 'risk_adherence',
  };

  const column = columnMap[metric];
  if (!column || column === 'current_streak' || column === 'risk_adherence') {
    // These are computed, not stored directly — skip
    return;
  }

  const supabase = createServerClient();

  try {
    // Check if row exists
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
          baskets_created: column === 'baskets_created' ? increment : 0,
          trades_executed: column === 'trades_executed' ? increment : 0,
          ai_sessions: column === 'ai_sessions' ? increment : 0,
          style_consistency: column === 'style_consistency' ? increment : 50,
        });
    }
  } catch (err: any) {
    console.error('[investor-score] updateScoreMetric error:', err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function estimateRiskAdherence(
  riskTolerance: string | undefined,
  scores: any
): number {
  if (scores.style_consistency && scores.style_consistency > 0) {
    const activityBonus = Math.min(50, (scores.trades_executed || 0) * 3);
    return Math.min(100, 50 + activityBonus);
  }

  if (riskTolerance === 'conservative') return scores.trades_executed > 10 ? 70 : 85;
  if (riskTolerance === 'aggressive') return scores.trades_executed > 5 ? 80 : 60;
  return 70;
}
