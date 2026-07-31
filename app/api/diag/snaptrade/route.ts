// ─── TEMP: SnapTrade Diagnostic ───────────────────────────
// Hits the SnapTrade API directly for Alpaca Paper connection.
// REMOVE after verifying real account data vs what Vantage shows.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { snapTradeFetch } from '@/lib/snaptrade/auth';
import { decryptData, deriveUserKey } from '@/lib/vault';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = req.nextUrl.searchParams.get('s');
  if (secret !== 'vfy26') {
    return NextResponse.json({ error: 'no' }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Get the Alpaca Paper connection
  const { data: conn } = await supabase
    .from('broker_connections')
    .select('*')
    .eq('brokerage_slug', 'ALPACA-PAPER')
    .eq('status', 'connected')
    .maybeSingle();

  if (!conn) {
    return NextResponse.json({ error: 'No Alpaca Paper connection found' }, { status: 404 });
  }

  // Decrypt SnapTrade secret
  const userId = conn.snaptrade_user_id;
  const payload = conn.snaptrade_user_secret_encrypted;
  const key = deriveUserKey(conn.user_id);
  let userSecret: string;
  try {
    // decryptData from vault uses {encrypted, iv, authTag} format
    const wrap = JSON.parse(payload);
    userSecret = decryptData(payload, key);
  } catch (e: any) {
    // If parsing fails, maybe it's already plain?
    // Try getOrCreateSnapTradeUser which handles the vault decryption
    const snapUser = await getOrCreateSnapTradeUser(
      conn.user_id,
      conn.snaptrade_user_id,
      conn.snaptrade_user_secret_encrypted,
    );
    userSecret = snapUser.userSecret;
  }

  const connectionId = conn.snaptrade_connection_id;

  // 1. Raw accounts endpoint
  let rawAccounts: any = null;
  try {
    rawAccounts = await snapTradeFetch<any[]>(
      `/authorizations/${connectionId}/accounts`,
      null,
      { userId, userSecret },
    );
  } catch (e: any) {
    rawAccounts = { error: e.message };
  }

  // 2. Raw holdings for each account
  const rawHoldings: any[] = [];
  if (Array.isArray(rawAccounts)) {
    for (const acct of rawAccounts) {
      try {
        const h = await snapTradeFetch<any[]>(
          `/authorizations/${connectionId}/accounts/${acct.id}/holdings`,
          null,
          { userId, userSecret },
        );
        rawHoldings.push({ accountId: acct.id, accountName: acct.name, holdings: h });
      } catch (e: any) {
        rawHoldings.push({ accountId: acct.id, error: e.message });
      }
    }
  }

  // 3. Summary
  const summary = {
    storedSnaptradeAccounts: conn.snaptrade_accounts,
    snapTradeAccountsResponse: rawAccounts,
    holdings: rawHoldings,
    connectionBrokerSlug: conn.brokerage_slug,
    connectionTradingEnabled: conn.trading_enabled,
    connectionStatus: conn.status,
    userId: conn.user_id,
    snapTradeUserId: conn.snaptrade_user_id,
  };

  return NextResponse.json(summary);
}
