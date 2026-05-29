// ─── Broker Session Endpoint ───────────────────────────────────
// GET /api/broker/session
//
// Returns broker-specific session info for client adapter initialization.
// This is the ONLY endpoint that returns key material to the client,
// and only the minimum needed for WebSocket streaming (Alpaca) or
// session token (Tastytrade).
//
// Keys decrypted from vault are held only for the duration of this request.

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getConnectionStatus, getCredentials } from '@/lib/vault';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(_req);

    // Check if user has a connected broker
    const status = await getConnectionStatus(userId);

    if (!status.connected || !status.brokerId) {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          message: 'No broker connected. Connect a broker first.',
        },
        { status: 404 }
      );
    }

    // Decrypt credentials (server-side only)
    let credentials: Record<string, unknown>;
    try {
      const result = await getCredentials(userId);
      credentials = result.credentials;
    } catch (err) {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          message: 'Failed to retrieve credentials. Please reconnect your broker.',
        },
        { status: 500 }
      );
    }

    const apiKey = String(credentials.apiKey || '');
    const secretKey = String(credentials.secretKey || '');
    const environment = String(credentials.environment || 'paper');

    if (status.brokerId === 'alpaca') {
      const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;

      // Verify connectivity and get account preview
      let accountData: Record<string, unknown> | null = null;
      let marketOpen = false;

      try {
        const headers = {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': secretKey,
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
        // WS auth payload — the ONLY key material returned to client
        wsAuth: {
          key: apiKey,
          secret: secretKey,
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

    if (status.brokerId === 'tastytrade') {
      const baseUrl = environment === 'live' ? TASTYTRADE_LIVE : TASTYTRADE_SANDBOX;

      // Obtain a session token for the client
      let sessionToken: string | null = null;

      try {
        const res = await fetch(`${baseUrl}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login: apiKey,
            password: secretKey,
            'remember-me': true, // long-lived session for streaming
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
          {
            headers: { Authorization: sessionToken },
          }
        );
        if (streamerRes.ok) {
          const streamerData = await streamerRes.json() as Record<string, unknown>;
          const streamer = (streamerData.data as Record<string, unknown>) || {};
          streamerUrl = (streamer['websocket-url'] as string) || (streamer.url as string) || null;
          streamerToken = (streamer.token as string) || null;
        }
      } catch {
        // Non-critical — client can request streamer info later
      }

      return NextResponse.json({
        configured: true,
        connected: true,
        brokerId: 'tastytrade',
        environment,
        environmentUrl: baseUrl,
        // Session token for authenticated API calls
        sessionToken,
        streamerUrl,
        streamerToken,
      });
    }

    return NextResponse.json(
      {
        configured: false,
        connected: false,
        message: `Unsupported broker: ${status.brokerId}`,
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
