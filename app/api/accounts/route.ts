// ─── Account List Endpoint ────────────────────────────────────
// GET /api/accounts
//
// Returns a unified list of all user accounts:
// 1. Demo Portfolio (always present)
// 2. Each connected SnapTrade broker with account summary
//
// Used by AccountSwitcher to populate the persistent account selector.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { SnapTradeBroker } from '@/lib/broker/snaptrade-broker';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { withTimeout } from '@/lib/async-guards';

// ── Bounded live fetch + short TTL cache ────────────────────
// The live SnapTrade round-trip (accounts list + one balances call per
// sub-account) is the slow part of first load — a multi-sub-account broker like
// Fidelity does 1 + N sequential-ish round trips, and a hanging upstream turned
// "slow" into "failed first load". Two guards:
//   1. withTimeout — a hung broker fetch can no longer stall the route; we
//      fall back to the stored `snaptrade_accounts` snapshot (see catch).
//   2. a short in-process TTL cache — repeat reads (account switcher reopen,
//      tab navigation) don't re-pay the round-trip.
const ACCOUNTS_LIVE_TIMEOUT_MS = 8_000;
const ACCOUNTS_CACHE_TTL_MS = 30_000;
type SubAccountSummary = { id: string | null; name: string; totalValue: number; cash: number; buyingPower: number | null };
const subAccountsCache = new Map<string, { at: number; value: SubAccountSummary[] }>();

export interface AccountEntry {
  id: string;
  name: string;
  broker: string;
  brokerageSlug?: string; // e.g. 'ALPACA-PAPER' — for logo lookups
  isDemo: boolean;
  tradingEnabled: boolean;
  totalValue: number;
  buyingPower: number | null;
  cash: number;
  environment: 'demo' | 'paper' | 'live';
  connectionId?: string; // broker_connections UUID, only for live accounts
  snapAccountId?: string; // SnapTrade sub-account id (3-part id form), when known
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const accounts: AccountEntry[] = [];

    // ── 1. Demo account — always present ──
    // Fetch demo portfolio state for total value
    const { data: demoState } = await supabaseAdmin
      .from('demo_portfolio_state')
      .select('positions, cash_balance')
      .eq('user_id', userId)
      .maybeSingle();

    let demoEquity = 100_000;
    let demoCash = 100_000;
    if (demoState) {
      demoCash = demoState.cash_balance ?? 100_000;
      const positions = (demoState.positions as any[]) || [];
      const positionValue = positions
        .filter((p: any) => p?.symbol && p.symbol !== '')
        .reduce((sum: number, p: any) => sum + (p.marketValue ?? p.totalCost ?? 0), 0);
      demoEquity = demoCash + positionValue;
    }

    accounts.push({
      id: 'demo',
      name: 'Demo Portfolio',
      broker: 'Vantage Demo',
      isDemo: true,
      tradingEnabled: true,
      totalValue: demoEquity,
      buyingPower: demoCash, // Demo: buying power = cash (no margin)
      cash: demoCash,
      environment: 'demo',
    });

    // ── 2. SnapTrade broker connections ──
    const { data: connections } = await supabaseAdmin
      .from('broker_connections')
      .select('id, brokerage_slug, trading_enabled, snaptrade_accounts, snaptrade_connection_id, snaptrade_user_id, snaptrade_user_secret_encrypted, status')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected');

    if (connections) {
      for (const conn of connections) {
        const snapAccounts = (conn.snaptrade_accounts as any[]) || [];
        const brokerName = mapSlugToName(conn.brokerage_slug);
        const environment: 'paper' | 'live' =
          conn.brokerage_slug === 'ALPACA-PAPER' ? 'paper' : 'live';

        // ── Enumerate every SnapTrade SUB-ACCOUNT separately ──
        // A connection can expose several accounts (Fidelity → "Taxable SMA" +
        // "ANIKET - YOUTH"). Each is its own entry with its OWN balances —
        // never summed. Bounded fetch + short TTL cache so a second read doesn't
        // re-pay the round-trip.
        const cached = subAccountsCache.get(conn.id);
        let subs: SubAccountSummary[] | null =
          cached && Date.now() - cached.at < ACCOUNTS_CACHE_TTL_MS ? cached.value : null;

        if (!subs) {
          try {
            const snapUser = await getOrCreateSnapTradeUser(
              userId,
              conn.snaptrade_user_id,
              conn.snaptrade_user_secret_encrypted,
            );
            const broker = new SnapTradeBroker({
              userId: snapUser.userId,
              userSecret: snapUser.userSecret,
              connectionId: conn.snaptrade_connection_id || '',
              brokerSlug: conn.brokerage_slug,
              brokerName,
              tradingEnabled: conn.trading_enabled ?? false,
            });
            const live = await withTimeout(broker.listSubAccounts(), ACCOUNTS_LIVE_TIMEOUT_MS, 'accounts:snaptrade');
            if (live.length > 0) {
              subs = live.map((s) => ({ ...s, id: s.id || null }));
              subAccountsCache.set(conn.id, { at: Date.now(), value: subs });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errStack = err instanceof Error ? (err.stack || '').substring(0, 200) : '';
            console.error('[accounts] SnapTrade live fetch FAILED (using stored snapshot):', errMsg, errStack);
          }
        }

        if (!subs || subs.length === 0) {
          // Fall back to the stored snapshot — one entry per stored sub-account
          // when it carries an id, else a single connection-level entry. A slow
          // or hung broker fetch must never turn into a failed first load.
          subs = snapAccounts.length > 0
            ? snapAccounts.map((a: any) => ({
                id: a.id || null,
                name: a.name || brokerName,
                totalValue: a.totalValue ?? a.total_value ?? 0,
                cash: a.cash ?? 0,
                buyingPower: a.buyingPower ?? a.buying_power ?? null,
              }))
            : [{ id: null, name: brokerName, totalValue: 0, cash: 0, buyingPower: null }];
        }

        const multi = subs.length > 1;
        for (const sub of subs) {
          accounts.push({
            id: sub.id ? `snaptrade:${conn.id}:${sub.id}` : `snaptrade:${conn.id}`,
            name: sub.name || brokerName,
            broker: brokerName,
            brokerageSlug: conn.brokerage_slug,
            isDemo: false,
            tradingEnabled: conn.trading_enabled ?? false,
            totalValue: sub.totalValue,
            buyingPower: sub.buyingPower,
            cash: sub.cash,
            environment,
            connectionId: conn.id,
            snapAccountId: sub.id || undefined,
          });
          if (multi && !sub.id) {
            // Stored snapshot had no per-account id: the entries are not
            // individually addressable, so label them so the UI can tell them apart.
            accounts[accounts.length - 1].name = `${brokerName} · ${sub.name}`;
          }
        }
      }
    }

    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    console.error('[accounts] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function mapSlugToName(slug: string): string {
  const map: Record<string, string> = {
    'ALPACA-PAPER': 'Alpaca Paper',
    'ALPACA': 'Alpaca',
    'FIDELITY': 'Fidelity',
    'TASTYTRADE': 'Tastytrade',
    'ETRADE': 'E*TRADE',
    'WEBULL': 'Webull',
    'PUBLIC': 'Public',
    'MOOMOO': 'Moomoo',
    'IBKR': 'Interactive Brokers',
    'SCHWAB': 'Charles Schwab',
    'ROBINHOOD': 'Robinhood',
  };
  return map[slug] || slug;
}
