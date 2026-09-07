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
import { parseAccountScope } from '@/lib/account-scope';
import { resolveBrokerNoticedInput } from '@/lib/noticed/resolve-input';

// ── GET: Return visible items (no re-check) ──
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ items: [] });

  const accountId = req.nextUrl.searchParams.get('accountId') || 'demo';

  const supabase = createServerClient() as any;
  const { data: items } = await supabase
    .from('noticed_items')
    .select('*')
    .eq('user_id', userId)
    .eq('account_id', accountId)
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
    // Canonical account id ('demo' | 'snaptrade:<conn_id>'), default demo.
    const accountId = (typeof body.accountId === 'string' && body.accountId) ? body.accountId : 'demo';

    // ── Resolve pipeline input ──
    // Broker accounts: re-derive positions + portfolio SERVER-SIDE from the
    // canonical `positions` table so the client can never write demo (or
    // another account's) positions under a broker account id — the source of
    // the cross-account bleed. Demo keeps client-sent positions because demo
    // state stores cost-basis pricing only (no live quotes server-side).
    const scope = parseAccountScope(accountId);
    let input: NoticedRuleInput;
    if (scope && !scope.isDemo) {
      const resolved = await resolveBrokerNoticedInput(supabase, userId, accountId, watchlistSymbols);
      if (!resolved) {
        return NextResponse.json({ items: [], error: 'No positions for account' });
      }
      input = resolved;
    } else {
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

      input = {
        account: portfolio,
        positions,
        watchlistSymbols,
        daysSinceLastTrade,
      };
    }

    // ── Get existing trigger keys (scoped to account) ──
    const { data: existing } = await supabase
      .from('noticed_items')
      .select('trigger_key')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('resolved', false);

    const existingKeys = new Set<string>((existing || []).map((e: any) => e.trigger_key));

    // ── Get investor style + thresholds for drift/concentration/milestone detection ──
    let investorStyle: string | null = null;
    let concSinglePct: number | null = null;
    let concTop3Pct: number | null = null;
    let targetReturnPct: number | null = null;
    let targetLossPct: number | null = null;
    try {
      const { data: userRow } = await supabase
        .from('users')
        .select('investor_style, conc_single_pct, conc_top3_pct, target_return_pct, target_loss_pct')
        .eq('id', userId)
        .single();
      investorStyle = userRow?.investor_style || null;
      concSinglePct = userRow?.conc_single_pct ?? null;
      concTop3Pct = userRow?.conc_top3_pct ?? null;
      targetReturnPct = userRow?.target_return_pct ?? null;
      targetLossPct = userRow?.target_loss_pct ?? null;
    } catch { /* ignore */ }

    // ── Run the full noticed pipeline ──
    const { trulyNew, haikuGenerated, budgetRemaining } = await runNoticedPipeline({
      userId,
      accountId,
      input,
      investorStyle,
      existingKeys,
      supabase,
      concSinglePct,
      concTop3Pct,
      targetReturnPct,
      targetLossPct,
    });

    // ── Return visible items ──
    const { data: visible } = await supabase
      .from('noticed_items')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', accountId)
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
