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
