// ─── GET /api/usage/remaining ──────────────────────────────
// Quick remaining-count check for chat guard.
// Accepts ?localDate=YYYY-MM-DD for user's timezone.
//
// Deep analysis is constrained by MULTIPLE independent counters:
//   - daily limit (resets at local midnight)
//   - monthly limit (Silver/Gold, resets on the 1st)
//   - demo trial pool (lifetime, does NOT reset daily — the 30-day pool)
// We return the binding (lowest) remaining so the UI can warn "last one"
// correctly and explain WHICH limit is exhausted instead of a bare "0 left".

import { NextRequest, NextResponse } from 'next/server';
import { checkUsageLimit, getLocalDateFromTimezone } from '@/lib/ai-guard';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const localDate = searchParams.get('localDate') || getLocalDateFromTimezone();

  const chatCheck = await checkUsageLimit(userId, 'message', localDate);
  const deepCheck = await checkUsageLimit(userId, 'deepAnalysis', localDate);

  // ── Resolve the additional deep-analysis constraints (pool / monthly) ──
  let deepPoolRemaining: number | null = null;
  let deepPoolLimit: number | null = null;
  let deepMonthlyRemaining: number | null = null;

  try {
    const supabase = createServerClient();
    const { data: userData } = await (supabase as any)
      .from('users')
      .select('tier, monthly_deep_used, demo_deep_pool_used')
      .eq('id', userId)
      .single();

    const tier = userData?.tier || 'demo';

    if (tier === 'demo') {
      const { data: poolLimit } = await (supabase as any)
        .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'demo_deep_pool' });
      if (typeof poolLimit === 'number' && poolLimit > 0) {
        deepPoolLimit = poolLimit;
        deepPoolRemaining = Math.max(0, poolLimit - (userData?.demo_deep_pool_used || 0));
      }
    } else {
      const { data: monthlyLimit } = await (supabase as any)
        .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'monthly_deep_limit' });
      if (typeof monthlyLimit === 'number' && monthlyLimit > 0) {
        deepMonthlyRemaining = Math.max(0, monthlyLimit - (userData?.monthly_deep_used || 0));
      }
    }
  } catch { /* fail open — daily remaining still authoritative */ }

  // Binding (lowest) remaining across daily + pool + monthly.
  // deepCheck.remaining is the daily remaining (or 0 when a constraint is hit).
  const candidates = [deepCheck.remaining, deepPoolRemaining, deepMonthlyRemaining]
    .filter((n): n is number => n != null);
  const effectiveDeepRemaining = Math.min(...candidates);

  return NextResponse.json({
    chatRemaining: chatCheck.remaining,
    deepRemaining: deepCheck.remaining,
    deepPoolRemaining,
    deepPoolLimit,
    deepMonthlyRemaining,
    effectiveDeepRemaining,
    // Binding reason/reset (set when a limit is already exhausted):
    deepReason: deepCheck.reason || null,
    deepResetsIn: deepCheck.resetsIn || null,
  });
}
