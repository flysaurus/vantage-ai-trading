// ─── GET /api/usage/stats ──────────────────────────────────
// Full usage breakdown for AI Settings panel (chat/message quota only).
// Deep Dive costs 2 of the message quota — no separate deep counters or limits.

import { NextRequest, NextResponse } from 'next/server';
import { getOptionalUserId } from '@/lib/auth/get-server-user';
import { getLocalDateFromTimezone } from '@/lib/ai-guard';
import { createServerClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const userId = await getOptionalUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  // Use user's local date (browser timezone), not server UTC
  const localDate = searchParams.get('localDate') || getLocalDateFromTimezone();

  const supabase = createServerClient();

  // Get user tier + monthly chat counter
  let tier = 'demo';
  let monthlyChatUsed = 0;
  let monthlyChatLimit = 0;
  let demoExpiresAt: string | null = null;

  try {
    const { data: userData } = await (supabase as any)
      .from('users')
      .select('tier, monthly_chat_used, demo_expires_at')
      .eq('id', userId)
      .single();

    tier = userData?.tier || 'demo';
    monthlyChatUsed = userData?.monthly_chat_used || 0;
    demoExpiresAt = userData?.demo_expires_at || null;
  } catch { /* fail open */ }

  // Get monthly chat limit from DB
  try {
    const { data: mcLimit } = await (supabase as any)
      .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'monthly_chat_limit' });
    if (typeof mcLimit === 'number') monthlyChatLimit = mcLimit;
  } catch { /* fail open */ }

  // ── Daily usage counts (user's local date, not server UTC) ──
  let dailyChatUsed = 0;

  try {
    const { data: usageData } = await (supabase as any)
      .from('ai_usage')
      .select('message_count')
      .eq('user_id', userId)
      .eq('date', localDate)
      .single();

    dailyChatUsed = usageData?.message_count || 0;
  } catch { /* fail open */ }

  // ── Daily limits — always from the DB tier tables, never hardcoded ──
  // DAILY CHAT LIMIT DISABLED (Em, Sep 15 2026): reported as 0 so the panel
  // renders "unlimited" and nothing can style it as exhausted. The daily
  // counter above is still returned for information. Restore by deleting the
  // `DAILY_CHAT_LIMIT_DISABLED` override below.
  let dailyChatLimit = 0;
  const DAILY_CHAT_LIMIT_DISABLED = true;

  if (!DAILY_CHAT_LIMIT_DISABLED) {
    try {
      const { data: chatLimit } = await (supabase as any)
        .rpc('get_tier_limit', { p_user_id: userId, p_feature_key: 'ai_message_limit' });
      if (typeof chatLimit === 'number') dailyChatLimit = chatLimit;
      else console.warn('[usage/stats] get_tier_limit(ai_message_limit) returned non-number:', chatLimit);
    } catch (err: any) {
      console.error('[usage/stats] get_tier_limit(ai_message_limit) RPC failed:', err.message);
    }
  }

  return NextResponse.json({
    tier,
    chat: {
      daily: { used: dailyChatUsed, limit: dailyChatLimit },
      monthly: tier !== 'demo' ? { used: monthlyChatUsed, limit: monthlyChatLimit } : null,
    },
    demoExpiresAt,
  });
}
