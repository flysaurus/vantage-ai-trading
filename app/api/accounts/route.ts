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

export interface AccountEntry {
  id: string;
  name: string;
  broker: string;
  brokerageSlug?: string; // e.g. 'ALPACA-PAPER' — for logo lookups
  isDemo: boolean;
  tradingEnabled: boolean;
  totalValue: number;
  buyingPower: number;
  cash: number;
  environment: 'demo' | 'paper' | 'live';
  connectionId?: string; // broker_connections UUID, only for live accounts
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
      buyingPower: demoCash,
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
        let totalValue = 0;
        let cash = 0;
        let buyingPower = 0;
        let accountName = mapSlugToName(conn.brokerage_slug);

        // Try to fetch live account data from SnapTrade
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
            brokerName: mapSlugToName(conn.brokerage_slug),
            tradingEnabled: conn.trading_enabled ?? false,
          });
          const summary = await broker.getAccount();
          totalValue = summary.totalValue;
          cash = summary.cashBalance;
          buyingPower = summary.buyingPower;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? (err.stack || '').substring(0, 200) : '';
          console.error('[accounts] SnapTrade live fetch FAILED:', errMsg, errStack);
          // Fall back to stored data
          const snapAccounts = (conn.snaptrade_accounts as any[]) || [];
          totalValue = snapAccounts.reduce((sum: number, a: any) => sum + (a.totalValue || a.total_value || 0), 0);
          cash = snapAccounts.reduce((sum: number, a: any) => sum + (a.cash || 0), 0);
          buyingPower = snapAccounts.reduce((sum: number, a: any) => sum + (a.buyingPower || a.buying_power || 0), 0);
          accountName = snapAccounts[0]?.name || accountName;
        }

        accounts.push({
          id: `snaptrade:${conn.id}`,
          name: accountName,
          broker: mapSlugToName(conn.brokerage_slug),
          brokerageSlug: conn.brokerage_slug,
          isDemo: false,
          tradingEnabled: conn.trading_enabled ?? false,
          totalValue,
          buyingPower,
          cash,
          environment: conn.brokerage_slug === 'ALPACA-PAPER' ? 'paper' : 'live',
          connectionId: conn.id,
        });
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
