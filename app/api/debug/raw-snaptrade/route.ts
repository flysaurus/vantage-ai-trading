// ─── GET /api/debug/raw-snaptrade ─────────────────────────
// TEMPORARY: Returns raw SnapTrade API responses via service key auth.
// DELETE THIS FILE after debugging is complete.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { snapTradeFetch } from '@/lib/snaptrade/auth';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: conn } = await supabase
      .from('broker_connections')
      .select('*')
      .eq('connection_type', 'snaptrade')
      .single();

    if (!conn?.snaptrade_user_id || !conn?.snaptrade_user_secret_encrypted) {
      return NextResponse.json({ error: 'no connection' }, { status: 404 });
    }

    // Decrypt using Supabase user_id (NOT snaptrade_user_id)
    const { deriveUserKey, decryptData } = await import('@/lib/vault');
    const userKey = deriveUserKey(conn.user_id);
    const userSecret = decryptData(conn.snaptrade_user_secret_encrypted, userKey);

    const userId = conn.snaptrade_user_id;
    const authId = conn.snaptrade_connection_id;
    const ep = { userId, userSecret };

    const raw: Record<string, unknown> = {
      broker: conn.brokerage_slug,
      authorizationId: authId,
    };

    // 1. Get authorization detail
    try {
      raw.authorization = await snapTradeFetch<unknown>(
        `/authorizations/${authId}`, null, ep,
      );
    } catch (e) { raw.authorization_error = (e as Error).message; }

    // 2. Get accounts
    let accountsArr: Array<{ id: string; name: string }> = [];
    try {
      const accts = await snapTradeFetch<unknown>(
        `/authorizations/${authId}/accounts`, null, ep,
      );
      raw.accounts = accts;
      accountsArr = Array.isArray(accts) ? accts as Array<{ id: string; name: string }> : [];
    } catch (e) { raw.accounts_error = (e as Error).message; }

    // 3. For each account, get balances + positions
    for (const acct of accountsArr) {
      const prefix = `account_${acct.id}`;
      raw[`${prefix}_name`] = acct.name;

      try {
        raw[`${prefix}_balances`] = await snapTradeFetch<unknown>(
          `/accounts/${acct.id}/balances`, null, ep,
        );
      } catch (e) { raw[`${prefix}_balances_error`] = (e as Error).message; }

      try {
        raw[`${prefix}_positions`] = await snapTradeFetch<unknown>(
          `/accounts/${acct.id}/positions`, null, ep,
        );
      } catch (e) { raw[`${prefix}_positions_error`] = (e as Error).message; }
    }

    return NextResponse.json(raw);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, stack: (err as Error).stack },
      { status: 500 },
    );
  }
}
