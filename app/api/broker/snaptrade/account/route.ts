// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns aggregated account balances across all SnapTrade-
// connected brokerage accounts for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';

const SNAPTRADE_API = 'https://api.snaptrade.com/api/v1';

// ─── Dev mode — realistic synthetic data ─────────────────
const DEV_ACCOUNT = {
  equity: 101_779.14,
  cash: 12_345.67,
  buying_power: 12_345.67,
  status: 'ACTIVE',
  currency: 'USD',
};

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Dev mode — return synthetic data ─────────────────
  const clientId = process.env.SNAPTRADE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(DEV_ACCOUNT);
  }

  const debug: Record<string, unknown> = {
    step: 'start',
    supabaseUserId: authUser.id,
    hasClientId: !!clientId,
    hasConsumerKey: !!process.env.SNAPTRADE_CONSUMER_KEY,
  };

  // ── Step A: Resolve credentials ───────────────────────
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    debug.step = 'credentials_resolved';
    debug.snaptradeUserId = snaptradeUserId;
    debug.secretLen = snaptradeUserSecret.length;
    debug.connectionId = creds.connectionId;
    debug.brokerSlug = creds.brokerSlug;
  } catch (err) {
    debug.step = 'credential_resolution_failed';
    debug.errorName = (err as Error).name;
    debug.errorMessage = (err as Error).message;
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { error: err.message, _debug: debug },
        { status: err.status },
      );
    }
    debug.unexpectedError = true;
    return NextResponse.json(
      { error: 'Failed to load brokerage credentials.', _debug: debug },
      { status: 502 },
    );
  }

  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY || '';

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'clientId': clientId,
      'consumerKey': consumerKey,
    };

    // ── Step B: Call SnapTrade /accounts ────────────────
    const accountsUrl = `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`;
    debug.accountsUrl = accountsUrl.replace(snaptradeUserSecret, '***');
    const accountsRes = await fetch(accountsUrl, { headers });
    debug.accountsStatus = accountsRes.status;

    if (!accountsRes.ok) {
      debug.accountsErrorBody = await accountsRes.text().catch(() => 'unreadable');
      if (accountsRes.status === 401 || accountsRes.status === 403) {
        return NextResponse.json(
          { error: 'Broker connection expired. Please reconnect your broker.', _debug: debug },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to load account data from brokerage.', _debug: debug },
        { status: 502 },
      );
    }

    const accounts = (await accountsRes.json()) as { id: string; name: string }[];
    debug.accountCount = accounts.length;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      debug.result = 'empty_accounts';
      return NextResponse.json({
        equity: 0, cash: 0, buyingPower: 0,
        status: 'ACTIVE', currency: 'USD',
        _debug: debug,
      });
    }

    // ── Step C: Fetch per-account balances ──────────────
    let totalEquity = 0;
    let totalCash = 0;
    let totalBuyingPower = 0;
    debug.balanceFetches = { succeeded: 0, failed: 0 };

    for (const acct of accounts) {
      try {
        const balanceRes = await fetch(
          `${SNAPTRADE_API}/accounts/${acct.id}/balances?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
          { headers },
        );

        if (balanceRes.ok) {
          const balance = await balanceRes.json();
          const bal = balance.data || balance;
          totalEquity += Number(bal.equity || bal.total_value || 0);
          totalCash += Number(bal.cash || 0);
          totalBuyingPower += Number(bal.buying_power || bal.cash || 0);
          (debug.balanceFetches as any).succeeded++;
        } else {
          (debug.balanceFetches as any).failed++;
        }
      } catch {
        (debug.balanceFetches as any).failed++;
      }
    }

    debug.result = 'success';
    debug.finalEquity = totalEquity;
    return NextResponse.json({
      equity: totalEquity,
      cash: totalCash,
      buyingPower: totalBuyingPower,
      status: 'ACTIVE', currency: 'USD',
      _debug: debug,
    });
  } catch (err) {
    debug.result = 'unexpected_error';
    debug.errorMessage = (err as Error).message;
    return NextResponse.json(
      { error: 'Failed to load account data.', _debug: debug },
      { status: 502 },
    );
  }
}
