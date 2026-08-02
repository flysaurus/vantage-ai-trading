// ─── GET /api/debug/raw-snaptrade ─────────────────────────
// TEMPORARY: Returns raw SnapTrade API responses via service key auth.
// DELETE THIS FILE after debugging is complete.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

async function snapTradeFetch(
  endpoint: string,
  userId: string,
  userSecret: string,
): Promise<{ status: number; body: unknown; url: string }> {
  const clientId = process.env.SNAPTRADE_CLIENT_ID!;
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY!;
  const crypto = await import('crypto');

  const ts = Math.floor(Date.now() / 1000);
  const signStr = clientId + userId + userSecret + endpoint + ts;
  const sig = crypto
    .createHmac('sha256', consumerKey)
    .update(signStr)
    .digest('hex');

  const url = `https://api.snaptrade.com${endpoint}?clientId=${clientId}&timestamp=${ts}&userId=${userId}&userSecret=${userSecret}`;
  const res = await fetch(url, {
    headers: { Signature: sig, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, url: url.replace(userSecret, '***') };
}

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

    // Raw responses - no mapping, no transformation
    const [accountsRes, authorizationsRes] = await Promise.all([
      snapTradeFetch(`/authorizations/${authId}/accounts`, userId, userSecret),
      snapTradeFetch(`/authorizations/${authId}`, userId, userSecret),
    ]);

    const raw: Record<string, unknown> = {
      broker: conn.brokerage_slug,
      authorizationId: authId,
      accountsStatus: accountsRes.status,
      accountsUrl: accountsRes.url,
      accounts: accountsRes.body,
      authorizationStatus: authorizationsRes.status,
      authorization: authorizationsRes.body,
    };

    // Get balances + positions for each account
    const accountsArr = Array.isArray(accountsRes.body) ? accountsRes.body as Array<{ id: string; name: string }> : [];
    
    for (const acct of accountsArr) {
      const [balRes, posRes] = await Promise.all([
        snapTradeFetch(`/accounts/${acct.id}/balances`, userId, userSecret),
        snapTradeFetch(`/accounts/${acct.id}/positions`, userId, userSecret),
      ]);

      raw[`account_${acct.id}_name`] = acct.name;
      raw[`account_${acct.id}_balances_status`] = balRes.status;
      raw[`account_${acct.id}_balances_url`] = balRes.url;
      raw[`account_${acct.id}_balances`] = balRes.body;
      raw[`account_${acct.id}_positions_status`] = posRes.status;
      raw[`account_${acct.id}_positions_url`] = posRes.url;
      raw[`account_${acct.id}_positions`] = posRes.body;
    }

    return NextResponse.json(raw);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, stack: (err as Error).stack },
      { status: 500 },
    );
  }
}
