// ─── GET /api/broker/snaptrade/account ────────────────────
// Returns aggregated account balances across all SnapTrade-
// connected brokerage accounts for the authenticated user.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import {
  resolveSnapTradeCredentials,
  SnapTradeAuthError,
} from '@/lib/snaptrade/client';

// ─── Dev mode — realistic synthetic data ─────────────────
const DEV_ACCOUNT = {
  equity: 101_779.14,
  cash: 12_345.67,
  buying_power: 12_345.67,
  status: 'ACTIVE',
  currency: 'USD',
};

interface SnapTradeConnection {
  id: string;
  brokerage?: { id: string; name: string; slug: string };
  name?: string;
}

interface SnapTradeAccount {
  id: string;
  name: string;
  number?: string;
}

export async function GET(_req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  // ── Dev mode — return synthetic data ─────────────────
  if (!process.env.SNAPTRADE_CLIENT_ID) {
    return NextResponse.json(DEV_ACCOUNT);
  }

  const debug: Record<string, unknown> = {
    step: 'start',
    supabaseUserId: authUser.id,
  };

  // ── Step A: Resolve credentials ───────────────────────
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  let authorizationId: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
    authorizationId = creds.connectionId;
    debug.step = 'credentials_resolved';
    debug.snaptradeUserId = snaptradeUserId;
    debug.connectionId = authorizationId;
    debug.brokerSlug = creds.brokerSlug;
  } catch (err) {
    debug.step = 'credential_resolution_failed';
    debug.errorMessage = (err as Error).message;
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { error: err.message, _debug: debug },
        { status: err.status },
      );
    }
    return NextResponse.json(
      { error: 'Failed to load brokerage credentials.', _debug: debug },
      { status: 502 },
    );
  }

  const extraParams = { userId: snaptradeUserId, userSecret: snaptradeUserSecret };

  try {
    // ── Step B: List accounts for this authorization ──
    const accountsEndpoint = `/authorizations/${authorizationId}/accounts`;
    debug.accountsEndpoint = accountsEndpoint;
    const accounts = await snapTradeFetch<SnapTradeAccount[]>(
      accountsEndpoint,
      null,
      extraParams,
    );
    debug.accountCount = Array.isArray(accounts) ? accounts.length : 0;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      debug.result = 'empty_accounts';
      return NextResponse.json({
        equity: 0, cash: 0, buyingPower: 0,
        status: 'ACTIVE', currency: 'USD',
        _debug: debug,
      });
    }

    // ── Step C: Fetch balances for each account ────────
    let totalEquity = 0;
    let totalCash = 0;
    let totalBuyingPower = 0;
    debug.balanceFetches = { succeeded: 0, failed: 0 };

    for (const acct of accounts) {
      try {
        const balance = await snapTradeFetch<{
          currency?: string;
          cash?: number;
          buying_power?: number;
        }[]>(
          `/accounts/${acct.id}/balances`,
          null,
          extraParams,
        );

        if (Array.isArray(balance)) {
          for (const b of balance) {
            totalCash += Number(b.cash || 0);
            totalBuyingPower += Number(b.buying_power || 0);
          }
        }
        // SnapTrade returns total_value separately from balances for some brokers
        (debug.balanceFetches as any).succeeded++;
      } catch {
        (debug.balanceFetches as any).failed++;
      }
    }

    // ── Step D: Get account details for total equity ──
    try {
      const acctDetails = await snapTradeFetch<{
        total_value?: number;
      }>(
        `/accounts/${accounts[0].id}`,
        null,
        extraParams,
      );
      totalEquity = Number(acctDetails.total_value || 0);
    } catch {
      // If details fail, estimate from cash + buying power
      totalEquity = totalCash + totalBuyingPower;
      debug.equityFromEstimate = true;
    }

    if (totalEquity === 0) totalEquity = totalCash + totalBuyingPower;

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
    debug.result = 'snaptrade_api_error';
    debug.errorMessage = (err as Error).message;

    // Check for 401 in error message
    const msg = (err as Error).message;
    const statusCode = msg.includes('401') ? 401 : msg.includes('403') ? 403 : 502;

    if (statusCode === 401 || statusCode === 403) {
      return NextResponse.json(
        { error: 'Broker connection expired. Please reconnect your broker.', _debug: debug },
        { status: statusCode },
      );
    }
    return NextResponse.json(
      { error: 'Failed to load account data.', _debug: debug },
      { status: 502 },
    );
  }
}
