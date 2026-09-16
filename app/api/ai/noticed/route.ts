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

// ── Feed size cap ─────────────────────────────────────────
// A SAFETY cap on how many rows we ship to the client — NOT a materiality
// threshold. It used to be 5, which made the feed look like "only 5 positions
// crossed a threshold" while the Holdings badges (computed live from the
// positions themselves) correctly showed every crossing. Worse, the 14 active
// milestone rows could crowd genuinely new event_impact items out of the
// 5-row window. Milestone rows are filtered OUT downstream by
// isDeckEligible / isMoreFromRufusEligible, so raising the cap changes
// nothing except how much real content survives the window.
const NOTICED_FEED_LIMIT = 50;

/**
 * Resolve which stored `noticed_items.account_id` values are valid for the
 * ACTIVE account. This is the account-scoping fix for the stale-card bug:
 *
 *  - A specific sub-account ('snaptrade:<conn>:<acct>') sees its own rows, and
 *    ALSO the legacy connection-level rows ('snaptrade:<conn>') — but ONLY when
 *    the connection is UNAMBIGUOUS (a single sub-account). When a connection
 *    exposes 2+ sub-accounts (e.g. Fidelity → "Taxable SMA" + "ANIKET - YOUTH"),
 *    connection-level rows cannot be attributed to either, so they are treated
 *    as ambiguous and hidden rather than shown under the wrong account.
 *  - The legacy connection form ('snaptrade:<conn>') sees only its own rows —
 *    and for a SHARED login (2+ sub-accounts) it sees NOTHING: a
 *    connection-level row cannot be attributed to either sub-account, so
 *    serving it under the ambiguous scope would attribute data by guess.
 *  - Demo sees only 'demo'.
 */
export async function resolveNoticedAccountIds(
  supabase: any,
  userId: string,
  accountId: string,
): Promise<string[]> {
  const scope = parseAccountScope(accountId);
  if (!scope || scope.isDemo) return ['demo'];

  const connId = scope.connectionId as string;
  const legacy = `snaptrade:${connId}`;

  // How many sub-accounts does this connection expose? 2+ means a stored
  // connection-level row cannot be attributed to any single sub-account.
  // `null` = the lookup failed → keep the old single-account default so a DB
  // hiccup cannot blank the feed.
  let snapCount: number | null = null;
  try {
    const { data: conn } = await supabase
      .from('broker_connections')
      .select('snaptrade_accounts')
      .eq('id', connId)
      .eq('user_id', userId)
      .maybeSingle();
    const snapAccounts = conn?.snaptrade_accounts;
    if (Array.isArray(snapAccounts)) snapCount = snapAccounts.length;
  } catch { /* unknown → single-account default */ }

  const unambiguous = snapCount == null || snapCount <= 1;

  // Legacy/connection-level active account.
  if (!scope.snapAccountId) {
    // A shared login has no unambiguous account: report NOTHING rather than
    // attribute a legacy row to a guessed sub-account.
    if (!unambiguous) {
      console.warn(
        `[noticed] connection ${connId} exposes ${snapCount} accounts — connection-level feed scope is ambiguous, returning no items`,
      );
      return [];
    }
    return [legacy];
  }

  const own = `snaptrade:${connId}:${scope.snapAccountId}`;
  return unambiguous ? [own, legacy] : [own];
}

/** Shared select for the visible feed, scoped to a set of allowed account ids. */
async function fetchVisible(supabase: any, userId: string, accountIds: string[]) {
  const { data } = await supabase
    .from('noticed_items')
    .select('*')
    .eq('user_id', userId)
    .in('account_id', accountIds)
    .eq('resolved', false)
    .or(`dismissed_until.is.null,dismissed_until.lt.${new Date().toISOString().replace('Z', '')}`)
    .order('created_at', { ascending: false })
    .limit(NOTICED_FEED_LIMIT);
  return data as any[] | null;
}

// ── GET: Return visible items (no re-check) ──
export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = await getOptionalUserId();
  if (!userId) return NextResponse.json({ items: [] });

  const accountId = req.nextUrl.searchParams.get('accountId') || 'demo';

  const supabase = createServerClient() as any;
  const accountIds = await resolveNoticedAccountIds(supabase, userId, accountId);
  const items = await fetchVisible(supabase, userId, accountIds);

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
    const accountIds = await resolveNoticedAccountIds(supabase, userId, accountId);
    const visible = await fetchVisible(supabase, userId, accountIds);

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
