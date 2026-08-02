// ─── Broker Resolve Endpoint ──────────────────────────────────
// GET /api/broker/resolve
//
// Resolves the active broker for the current user and returns
// the necessary credentials for the client to create a broker
// engine. Only supports SnapTrade OAuth connections.
//
// This MUST be a server endpoint because decrypting the stored
// userSecret requires VAULT_ENCRYPTION_KEY which is server-only.

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';

interface BrokerConfig {
  brokerSource: 'snaptrade' | 'demo';
  // SnapTrade fields (only when brokerSource === 'snaptrade')
  snaptrade?: {
    userId: string;
    userSecret: string;
    connectionId: string;
    brokerSlug: string;
    brokerName: string;
    tradingEnabled: boolean;
  };
}

export async function GET(): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: conn } = await supabaseAdmin
      .from('broker_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    if (
      conn?.snaptrade_user_id &&
      conn?.snaptrade_user_secret_encrypted &&
      conn?.snaptrade_connection_id
    ) {
      // Decrypt server-side (VAULT_ENCRYPTION_KEY available here)
      const snapUser = await getOrCreateSnapTradeUser(
        userId,
        conn.snaptrade_user_id,
        conn.snaptrade_user_secret_encrypted,
      );

      const slug = conn.brokerage_slug || 'unknown';
      const brokerName = slug
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');

      const config: BrokerConfig = {
        brokerSource: 'snaptrade',
        snaptrade: {
          userId: snapUser.userId,
          userSecret: snapUser.userSecret,
          connectionId: conn.snaptrade_connection_id,
          brokerSlug: slug,
          brokerName,
          tradingEnabled: conn.trading_enabled ?? false,
        },
      };

      console.error('[broker/resolve] SnapTrade resolved:', brokerName);
      return NextResponse.json(config);
    }

    // No connected broker — return demo fallback
    console.error('[broker/resolve] No SnapTrade connection, demo fallback');
    return NextResponse.json({ brokerSource: 'demo' } as BrokerConfig);
  } catch (err) {
    console.error('[broker/resolve] Error:', err);
    return NextResponse.json({ brokerSource: 'demo' } as BrokerConfig);
  }
}
