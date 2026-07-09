// ─── GET /api/usage/stats ──────────────────────────────────
// Full usage breakdown for AI Settings panel:
// - Daily chat/deep usage with limits
// - Monthly usage (Silver/Gold)
// - Demo trial pool (Demo)
// - Tier + upgrade context

import { NextRequest, NextResponse } from 'next/server';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();

  // Get user tier + monthly/pool counters
  let tier = 'demo';
  let monthlyChatUsed = 0;
  let monthlyChatLimit = 0;
  let monthlyDeepUsed = 0;
  let monthlyDeepLimit = 0;
  let demoPoolUsed = 0;
  let demoPoolLimit = 0;
  let demoExpiresAt: string | null = null;

  try {
    const { data: userData } = await (supabase as any)
      .from('users')
      .select('tier, monthly_chat_used, monthly_deep_used, demo_deep_pool_used, demo_expires_at')
      .eq('id', userId)
      .single();

    tier = userData?.tier || 'demo';
    monthlyChatUsed = userData?.monthly_chat_used || 0;
    monthlyDeepUsed = userData?.monthly_deep_used || 0;
    demoPoolUsed = userData?.demo_deep_pool_used || 0;
    demoExpiresAt = userData?.demo_expires_at || null;
  } catch { /* fail open */ }

  // Get monthly limits from DB
  try {
    const { data: mcLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'monthly_chat_limit' });
    if (typeof mcLimit === 'number') monthlyChatLimit = mcLimit;
  } catch { /* fail open */ }

  try {
    const { data: mdLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'monthly_deep_limit' });
    if (typeof mdLimit === 'number') monthlyDeepLimit = mdLimit;
  } catch { /* fail open */ }

  try {
    const { data: dpLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'demo_deep_pool' });
    if (typeof dpLimit === 'number') demoPoolLimit = dpLimit;
  } catch { /* fail open */ }

  // ── Daily usage counts ──
  const today = new Date().toISOString().split('T')[0];

  let dailyChatUsed = 0;
  let dailyDeepUsed = 0;

  try {
    const { data: usageData } = await (supabase as any)
      .from('ai_usage')
      .select('message_count, deep_analysis_count')
      .eq('user_id', userId)
      .eq('date', today)
      .single();

    dailyChatUsed = usageData?.message_count || 0;
    dailyDeepUsed = usageData?.deep_analysis_count || 0;
  } catch { /* fail open */ }

  // ── Daily limits — always from the DB tier tables, never hardcoded ──
  let dailyChatLimit = 0;
  let dailyDeepLimit = 0;

  try {
    const { data: chatLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'ai_message_limit' });
    if (typeof chatLimit === 'number') dailyChatLimit = chatLimit;
    else console.warn('[usage/stats] get_tier_limit(ai_message_limit) returned non-number:', chatLimit);
  } catch (err: any) {
    console.error('[usage/stats] get_tier_limit(ai_message_limit) RPC failed:', err.message);
  }

  try {
    const { data: deepLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'deep_analysis_limit' });
    if (typeof deepLimit === 'number') dailyDeepLimit = deepLimit;
    else console.warn('[usage/stats] get_tier_limit(deep_analysis_limit) returned non-number:', deepLimit);
  } catch (err: any) {
    console.error('[usage/stats] get_tier_limit(deep_analysis_limit) RPC failed:', err.message);
  }

  return NextResponse.json({
    tier,
    chat: {
      daily: { used: dailyChatUsed, limit: dailyChatLimit },
      monthly: tier !== 'demo' ? { used: monthlyChatUsed, limit: monthlyChatLimit } : null,
    },
    deepAnalysis: {
      daily: { used: dailyDeepUsed, limit: dailyDeepLimit },
      monthly: tier !== 'demo' ? { used: monthlyDeepUsed, limit: monthlyDeepLimit } : null,
      demoPool: tier === 'demo' ? { used: demoPoolUsed, limit: demoPoolLimit } : null,
    },
    demoExpiresAt,
  });
}
