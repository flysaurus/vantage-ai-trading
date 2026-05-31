// ─── AI Context Debug Endpoint ───────────────────────────────
// Returns exact AIContext + BrokerContext to diagnose demo/Alpaca path.
// Access: GET /api/debug/context

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth';
import { getBrokerContext } from '@/lib/broker-service';
import { getConnectionStatus } from '@/lib/vault';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const supabase = createServerClient();

    // 1. What broker-service thinks
    let brokerCtx: any;
    try {
      brokerCtx = await getBrokerContext(userId);
    } catch (e: any) {
      brokerCtx = { error: e.message };
    }

    // 2. What the OLD vault system thinks
    let vaultStatus: any;
    try {
      vaultStatus = await getConnectionStatus(userId);
    } catch (e: any) {
      vaultStatus = { error: e.message };
    }

    // 3. Raw DB state
    const [userRow, apiConns, apiCreds, vaultEntries] = await Promise.all([
      (supabase as any).from('users').select('broker_connected, investor_style, api_provider').eq('id', userId).single(),
      (supabase as any).from('api_connections').select('*').eq('user_id', userId),
      (supabase as any).from('api_credentials').select('*').eq('user_id', userId),
      (supabase as any).from('vault').select('id, provider, is_connected, key_name').eq('user_id', userId),
    ]);

    return NextResponse.json({
      userId: userId.slice(0, 8),
      brokerContext: {
        isDemo: brokerCtx?.isDemo,
        provider: brokerCtx?.provider,
        hasCredentials: !!brokerCtx?.credentials,
        credentialsProvider: brokerCtx?.credentials?.provider,
        investorStyle: brokerCtx?.investorStyle,
        error: brokerCtx?.error,
      },
      oldVaultStatus: vaultStatus,
      database: {
        users: userRow?.data ? { broker_connected: userRow.data.broker_connected, investor_style: userRow.data.investor_style, api_provider: userRow.data.api_provider } : null,
        api_connections: apiConns?.data?.length > 0 ? apiConns.data.map((r: any) => ({ provider: r.provider, is_connected: r.is_connected, connection_verified: r.connection_verified })) : [],
        api_credentials: apiCreds?.data?.length > 0 ? apiCreds.data.map((r: any) => ({ provider: r.provider, is_active: r.is_active })) : [],
        vault: vaultEntries?.data?.length > 0 ? vaultEntries.data.map((r: any) => ({ id: r.id, provider: r.provider, is_connected: r.is_connected, key_name: r.key_name })) : [],
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
