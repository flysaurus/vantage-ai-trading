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

interface SnapTradeAccount {
  id: string;
  name: string;
  number: string;
  broker_name: string;
  balance?: {
    equity: number;
    cash: number;
    buying_power: number;
    currency: string;
  };
}

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

  // ── Resolve credentials via the ONE shared function ──
  let snaptradeUserId: string;
  let snaptradeUserSecret: string;
  try {
    const creds = await resolveSnapTradeCredentials(authUser.id);
    snaptradeUserId = creds.snaptradeUserId;
    snaptradeUserSecret = creds.snaptradeUserSecret;
  } catch (err) {
    if (err instanceof SnapTradeAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }
    console.error('[snaptrade/account] Credential resolution failed:', err);
    return NextResponse.json(
      { error: 'Failed to load brokerage credentials. Please reconnect your broker.' },
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

    const accountsRes = await fetch(
      `${SNAPTRADE_API}/accounts?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
      { headers },
    );

    if (!accountsRes.ok) {
      console.error(
        '[snaptrade/account] SnapTrade accounts request failed:',
        accountsRes.status,
      );
      // 401 from SnapTrade → tell the user their connection may need re-auth
      if (accountsRes.status === 401 || accountsRes.status === 403) {
        return NextResponse.json(
          { error: 'Broker connection expired. Please reconnect your broker.' },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to load account data from brokerage.' },
        { status: 502 },
      );
    }

    const accounts: SnapTradeAccount[] = await accountsRes.json();

    if (!Array.isArray(accounts) || accounts.length === 0) {
      // No accounts is not an auth error — just empty. Return zero values
      // so the consumer can distinguish "empty account" from "auth broken".
      return NextResponse.json({
        equity: 0,
        cash: 0,
        buying_power: 0,
        status: 'ACTIVE',
        currency: 'USD',
      });
    }

    let totalEquity = 0;
    let totalCash = 0;
    let totalBuyingPower = 0;

    for (const account of accounts) {
      try {
        const balanceRes = await fetch(
          `${SNAPTRADE_API}/accounts/${account.id}/balances?userId=${snaptradeUserId}&userSecret=${snaptradeUserSecret}`,
          { headers },
        );

        if (balanceRes.ok) {
          const balance = await balanceRes.json();
          const bal = balance.data || balance;
          totalEquity += Number(bal.equity || bal.total_value || 0);
          totalCash += Number(bal.cash || 0);
          totalBuyingPower += Number(bal.buying_power || bal.cash || 0);
        }
      } catch (err) {
        console.error(
          `[snaptrade/account] Balance fetch failed for ${account.id}:`,
          err instanceof Error ? err.message : String(err),
        );
        // non-fatal — skip this account
      }
    }

    return NextResponse.json({
      equity: totalEquity,
      cash: totalCash,
      buyingPower: totalBuyingPower,
      status: 'ACTIVE',
      currency: 'USD',
    });
  } catch (err) {
    console.error('[snaptrade/account] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Failed to load account data.' },
      { status: 502 },
    );
  }
}
