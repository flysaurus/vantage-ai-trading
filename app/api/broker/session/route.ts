// ─── Broker Session Endpoint ───────────────────────────────────
// GET /api/broker/session
//
// Returns broker-specific session info for client adapter initialization.
// This is the ONLY endpoint that returns key material to the client,
// and only the minimum needed for WebSocket streaming (Alpaca) or
// session token (Tastytrade).
//
// Keys decrypted from vault are held only for the duration of this request.
// Uses per-user credentials from Supabase Vault via broker-service.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getBrokerContext } from '@/lib/broker-service';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  let userId: string;
  try {
    const auth = await requireAuth(_req);
    userId = auth.userId;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const ctx = await getBrokerContext(userId);

    if (ctx.isDemo || !ctx.credentials || !ctx.provider) {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          message: ctx.isDemo
            ? 'No broker connected. Connect a broker first.'
            : 'Credentials unavailable',
        },
        { status: ctx.isDemo ? 404 : 500 }
      );
    }

    const creds = ctx.credentials;
    const environment = creds.alpacaBaseUrl?.includes('paper-api') ? 'paper' : 'live';

    if (ctx.provider === 'alpaca') {
      const baseUrl = creds.alpacaBaseUrl || ALPACA_LIVE;

      // Verify connectivity and get account preview
      let accountData: Record<string, unknown> | null = null;
      let marketOpen = false;

      try {
        const headers = {
          'APCA-API-KEY-ID': creds.alpacaApiKey!,
          'APCA-API-SECRET-KEY': creds.alpacaSecretKey!,
        };

        const [accRes, clockRes] = await Promise.all([
          fetch(`${baseUrl}/v2/account`, { headers }),
          fetch(`${baseUrl}/v2/clock`, { headers }),
        ]);

        if (accRes.ok) accountData = await accRes.json() as Record<string, unknown>;
        if (clockRes.ok) {
          const clock = await clockRes.json() as { is_open: boolean };
          marketOpen = clock.is_open;
        }
      } catch {
        return NextResponse.json({
          configured: true,
          connected: false,
          environment,
          message: 'Unable to reach Alpaca API',
        });
      }

      return NextResponse.json({
        configured: true,
        connected: true,
        brokerId: 'alpaca',
        environment,
        environmentUrl: baseUrl,
        wsAuth: {
          key: creds.alpacaApiKey,
          secret: creds.alpacaSecretKey,
        },
        accountPreview: accountData
          ? {
              id: accountData.id || accountData.account_number,
              equity: accountData.equity,
              buyingPower: accountData.buying_power,
              status: accountData.status,
            }
          : null,
        marketOpen,
      });
    }

    if (ctx.provider === 'tastytrade') {
      const baseUrl = TASTYTRADE_LIVE;

      let sessionToken: string | null = null;

      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login: creds.tastytradeApiKey,
            password: '',
            'remember-me': true,
          }),
        });

        if (!res.ok) {
          return NextResponse.json({
            configured: true,
            connected: false,
            brokerId: 'tastytrade',
            environment,
            message: 'Failed to authenticate with Tastytrade',
          });
        }

        const sessionData = await res.json() as Record<string, unknown>;
        sessionToken = (sessionData['session-token'] as string) || null;

        if (!sessionToken) {
          return NextResponse.json({
            configured: true,
            connected: false,
            brokerId: 'tastytrade',
            environment,
            message: 'No session token from Tastytrade',
          });
        }
      } catch {
        return NextResponse.json({
          configured: true,
          connected: false,
          brokerId: 'tastytrade',
          environment,
          message: 'Unable to reach Tastytrade API',
        });
      }

      // Get streamer info
      let streamerUrl: string | null = null;
      let streamerToken: string | null = null;
      try {
        const streamerRes = await fetch(
          `${baseUrl}/api-quote-tokens`,
          { headers: { Authorization: sessionToken } }
        );
        if (streamerRes.ok) {
          const streamerData = await streamerRes.json() as Record<string, unknown>;
          const streamer = (streamerData.data as Record<string, unknown>) || {};
          streamerUrl = (streamer['websocket-url'] as string) || (streamer.url as string) || null;
          streamerToken = (streamer.token as string) || null;
        }
      } catch {
        // Non-critical
      }

      return NextResponse.json({
        configured: true,
        connected: true,
        brokerId: 'tastytrade',
        environment,
        environmentUrl: baseUrl,
        sessionToken,
        streamerUrl,
        streamerToken,
      });
    }

    return NextResponse.json(
      {
        configured: false,
        connected: false,
        message: `Unsupported broker: ${ctx.provider}`,
      },
      { status: 400 }
    );
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Session API] Error:', err);
    return NextResponse.json(
      { configured: false, connected: false, message: String(err) },
      { status: 500 }
    );
  }
}
