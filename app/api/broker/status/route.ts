// ─── Broker Status Endpoint ────────────────────────────────────
// GET /api/broker/status
//
// Returns the current broker connection status and account preview.
// Does NOT decrypt or return credentials.
//
// If connected, pings the broker for account summary and market status.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getConnectionStatus, getCredentials } from '@/lib/vault';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

async function getAlpacaAccountPreview(
  apiKey: string,
  secretKey: string,
  environment: string
): Promise<Record<string, unknown> | null> {
  const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;
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
  environment: string
): Promise<boolean> {
  const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;
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

async function getTastytradeSession(
  apiKey: string,
  secretKey: string,
  environment: string
): Promise<string | null> {
  const baseUrl = environment === 'live' ? TASTYTRADE_LIVE : TASTYTRADE_SANDBOX;
  try {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        login: apiKey,
        password: secretKey,
        'remember-me': false,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    return (data['session-token'] as string) || null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(_req);

    // Check vault for connected broker (no decryption)
    const status = await getConnectionStatus(userId);

    if (!status.connected || !status.brokerId) {
      return NextResponse.json({
        connected: false,
        brokerId: null,
        accountPreview: null,
        marketOpen: false,
        environment: null,
      });
    }

    // Get decrypted credentials (server-side only, never returned to client)
    let credentials: Record<string, unknown> | null = null;
    try {
      const credResult = await getCredentials(userId);
      credentials = credResult.credentials;
    } catch {
      // Credentials corrupt or missing — report disconnected
      return NextResponse.json({
        connected: false,
        brokerId: status.brokerId,
        accountPreview: null,
        marketOpen: false,
        environment: null,
        error: 'Credentials not available',
      });
    }

    const apiKey = String(credentials.apiKey || '');
    const secretKey = String(credentials.secretKey || '');
    const environment = String(credentials.environment || 'paper');

    let accountPreview: Record<string, unknown> | null = null;
    let marketOpen = false;

    if (status.brokerId === 'alpaca') {
      accountPreview = await getAlpacaAccountPreview(apiKey, secretKey, environment);
      marketOpen = await getAlpacaMarketStatus(apiKey, secretKey, environment);
    } else if (status.brokerId === 'tastytrade') {
      // Tastytrade: get session for basic connectivity check
      const sessionToken = await getTastytradeSession(apiKey, secretKey, environment);
      if (sessionToken) {
        accountPreview = { connected: true };
      }
      // Tastytrade doesn't have a direct market clock — assume open during US hours
      const now = new Date();
      const hourET = now.getUTCHours() - 4; // rough ET conversion
      marketOpen = now.getUTCDay() >= 1 && now.getUTCDay() <= 5 && hourET >= 4 && hourET < 20;
    }

    return NextResponse.json({
      connected: true,
      brokerId: status.brokerId,
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
