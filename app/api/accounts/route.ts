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

export interface AccountEntry {
  id: string;
  name: string;
  broker: string;
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
      .select('id, brokerage_slug, trading_enabled, snaptrade_accounts, status')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected');

    if (connections) {
      for (const conn of connections) {
        const snapAccounts = (conn.snaptrade_accounts as any[]) || [];
        const totalValue = snapAccounts.reduce((sum: number, a: any) => sum + (a.totalValue || 0), 0);
        const buyingPower = snapAccounts.reduce((sum: number, a: any) => sum + (a.buyingPower || 0), 0);
        const cash = snapAccounts.reduce((sum: number, a: any) => sum + (a.cash || 0), 0);

        const brokerName = mapSlugToName(conn.brokerage_slug);

        accounts.push({
          id: `snaptrade:${conn.id}`,
          name: snapAccounts[0]?.name || brokerName,
          broker: brokerName,
          isDemo: false,
          tradingEnabled: conn.trading_enabled ?? false,
          totalValue: totalValue || 0,
          buyingPower: buyingPower || 0,
          cash: cash || 0,
          environment: conn.brokerage_slug === 'ALPACA-PAPER' ? 'paper' : 'live',
          connectionId: conn.id,
        });
      }
    }

    console.error('[accounts] Returning', accounts.length, 'accounts for user', userId);

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
