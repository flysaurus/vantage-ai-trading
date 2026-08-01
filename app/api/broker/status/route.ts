// ─── Broker Status Endpoint ────────────────────────────────────
// GET /api/broker/status
//
// Returns the current broker connection status and account preview.
// Does NOT decrypt or return credentials to the client.
//
// Uses per-user credentials from Supabase Vault via broker-service.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { getBrokerContext, makeAlpacaRequest } from '@/lib/broker-service';
import { createClient } from '@supabase/supabase-js';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

async function getAlpacaAccountPreview(
  apiKey: string,
  secretKey: string,
  baseUrl: string
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return {
      id: data.id || data.account_number,
      equity: data.equity,
      buyingPower: data.buying_power,
      status: data.status,
    };
  } catch {
    return null;
  }
}

async function getAlpacaMarketStatus(
  apiKey: string,
  secretKey: string,
  baseUrl: string
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/v2/clock`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });
    if (!res.ok) return false;
    const data = await res.json() as { is_open: boolean };
    return data.is_open;
  } catch {
    return false;
  }
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;

  try {
    // ── Check SnapTrade connections first (broker_connections table) ──
    // These are OAuth-based connections that don't store credentials in Vault.
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: snapConn } = await supabaseAdmin
      .from('broker_connections')
      .select('snaptrade_broker_id, brokerage_slug, trading_enabled, snaptrade_accounts, status')
      .eq('user_id', userId)
      .eq('connection_type', 'snaptrade')
      .eq('status', 'connected')
      .maybeSingle();

    if (snapConn) {
      const accounts = (snapConn.snaptrade_accounts as any[]) || [];
      const totalValue = accounts.reduce((sum: number, a: any) => sum + (a.totalValue || 0), 0);
      const buyingPower = accounts.reduce((sum: number, a: any) => sum + (a.buyingPower || 0), 0);
      const brokerSlug = snapConn.snaptrade_broker_id || snapConn.brokerage_slug || '';
      const isPaper = brokerSlug.toUpperCase().includes('PAPER');

      console.error(
        '[broker/status] SnapTrade connection detected:',
        'brokerSlug:', brokerSlug,
        'accounts:', accounts.length,
        'totalValue:', totalValue,
        'tradingEnabled:', snapConn.trading_enabled
      );

      return NextResponse.json({
        connected: true,
        brokerId: 'snaptrade',
        trading_enabled: snapConn.trading_enabled !== false,
        underlying_broker: brokerSlug,
        accountPreview: {
          id: accounts[0]?.id || 'snaptrade',
          equity: totalValue,
          buyingPower: buyingPower,
          status: 'ACTIVE',
        },
        marketOpen: false,
        environment: isPaper ? 'paper' : 'live',
      });
    }

    // ── Fall through to Vault-based check (Alpaca/Tastytrade API keys) ──
    const ctx = await getBrokerContext(userId);

    if (ctx.isDemo || !ctx.credentials || !ctx.provider) {
      return NextResponse.json({
        connected: false,
        brokerId: null,
        accountPreview: null,
        marketOpen: false,
        environment: null,
      });
    }

    const creds = ctx.credentials;
    let accountPreview: Record<string, unknown> | null = null;
    let marketOpen = false;

    if (ctx.provider === 'alpaca') {
      const baseUrl = creds.alpacaBaseUrl || ALPACA_LIVE;
      accountPreview = await getAlpacaAccountPreview(
        creds.alpacaApiKey!,
        creds.alpacaSecretKey!,
        baseUrl
      );
      marketOpen = await getAlpacaMarketStatus(
        creds.alpacaApiKey!,
        creds.alpacaSecretKey!,
        baseUrl
      );
    } else if (ctx.provider === 'tastytrade') {
      // Tastytrade: use session-based check
      try {
        const baseUrl = TASTYTRADE_LIVE; // Tastytrade credentials don't separate env in current model
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login: creds.tastytradeApiKey,
            password: '', // Tastytrade uses API key as login
            'remember-me': false,
          }),
        });
        if (res.ok) {
          accountPreview = { connected: true };
        }
      } catch {
        // Connection failed
      }
      const now = new Date();
      const hourET = now.getUTCHours() - 4;
      marketOpen = now.getUTCDay() >= 1 && now.getUTCDay() <= 5 && hourET >= 4 && hourET < 20;
    }

    const environment = creds.alpacaBaseUrl?.includes('paper-api') ? 'paper' : 'live';

    return NextResponse.json({
      connected: true,
      brokerId: ctx.provider,
      accountPreview,
      marketOpen,
      environment,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Status API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
