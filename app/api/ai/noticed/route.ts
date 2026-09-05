/**
 * POST /api/ai/noticed — Check triggers + generate AI copy + return visible items
 *
 * Accepts portfolio state from client. Runs rules engine, batch-generates
 * Haiku copy for new triggers, upserts to noticed_items, returns visible feed.
 *
 * GET returns current visible items without re-checking triggers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getOptionalUserId } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import type { NoticedRuleInput, PortfolioAccount, PortfolioPosition, NoticedTrigger } from '@/lib/noticed/engine';
import { runNoticedPipeline } from '@/lib/noticed/engine';

// ── GET: Return visible items (no re-check) ──
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ items: [] });

  const supabase = createServerClient() as any;
  const { data: items } = await supabase
    .from('noticed_items')
    .select('*')
    .eq('user_id', userId)
    .eq('resolved', false)
    .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
    .order('created_at', { ascending: false })
    .limit(5);

  return NextResponse.json({
    items: (items || []).map(formatItem),
  });
}

// ── POST: Full check + generation ──
export async function POST(req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  const supabase = createServerClient() as any;

  try {
    const body = await req.json().catch(() => ({}));
    const portfolio = body.portfolio as PortfolioAccount | undefined;
    const positions = (body.positions || []) as PortfolioPosition[];
    const watchlistSymbols = (body.watchlistSymbols || []) as string[];

    if (!portfolio) {
      return NextResponse.json({ items: [], error: 'Missing portfolio data' }, { status: 400 });
    }

    // ── Get days since last trade ──
    let daysSinceLastTrade = 999;
    try {
      const { data: lastTrade } = await supabase
        .from('trade_history')
        .select('executed_at')
        .eq('user_id', userId)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastTrade?.executed_at) {
        const lastDate = new Date(lastTrade.executed_at);
        daysSinceLastTrade = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    } catch { /* ignore */ }

    const input: NoticedRuleInput = {
      account: portfolio,
      positions,
      watchlistSymbols,
      daysSinceLastTrade,
    };

    // ── Get existing trigger keys ──
    const { data: existing } = await supabase
      .from('noticed_items')
      .select('trigger_key')
      .eq('user_id', userId)
      .eq('resolved', false);

    const existingKeys = new Set<string>((existing || []).map((e: any) => e.trigger_key));

    // ── Get investor style for drift detection ──
    let investorStyle: string | null = null;
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('investor_style')
        .eq('id', userId)
        .single();
      investorStyle = userRow?.investor_style || null;
    } catch { /* ignore */ }

    // ── Run the full noticed pipeline ──
    const { trulyNew, haikuGenerated, budgetRemaining } = await runNoticedPipeline({
      userId,
      input,
      investorStyle,
      existingKeys,
      supabase,
    });

    // ── Return visible items ──
    const { data: visible } = await supabase
      .from('noticed_items')
      .select('*')
      .eq('user_id', userId)
      .eq('resolved', false)
      .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
      .order('created_at', { ascending: false })
      .limit(5);

    return NextResponse.json({
      items: (visible || []).map(formatItem),
      newCount: trulyNew.length,
      haikuGenerated,
      budgetRemaining,
    });
  } catch (err: any) {
    console.error('[noticed] Error:', err.message);
    return NextResponse.json({ items: [], error: err.message }, { status: 500 });
  }
}

// ── Format DB row for client ──
function formatItem(row: any) {
  return {
    id: row.id,
    triggerKey: row.trigger_key,
    triggerType: row.trigger_type,
    title: row.title,
    body: row.body,
    followUp: row.follow_up || '',
    variant: row.variant,
    icon: row.icon,
    meta: row.meta,
    action: row.meta?.action || null,
    createdAt: row.created_at,
    dismissedUntil: row.dismissed_until,
  };
}
