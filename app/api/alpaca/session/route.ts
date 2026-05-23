// ─── Session Endpoint ────────────────────────────────────────
// Verifies Alpaca connectivity and returns a session payload
// for the client-side adapter. The adapter calls this on connect()
// instead of reading env vars directly.
//
// The session includes the WebSocket auth payload since
// Alpaca WS doesn't support token-based auth — but these
// credentials are short-lived in client memory and loaded
// from server env, not hardcoded.

import { type NextRequest, NextResponse } from 'next/server';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const keyId = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_SECRET_KEY;
    const environment = process.env.ALPACA_ENVIRONMENT === 'live' ? 'live' : 'paper';

    if (!keyId || !secretKey) {
      return NextResponse.json(
        {
          configured: false,
          message: 'Alpaca API keys not configured in server environment',
        },
        { status: 503 }
      );
    }

    // Verify connectivity by fetching account
    const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;

    let accountOk = false;
    let clockOk = false;
    let accountData: Record<string, unknown> | null = null;
    let clockData: Record<string, unknown> | null = null;

    try {
      const headers = {
        'APCA-API-KEY-ID': keyId,
        'APCA-API-SECRET-KEY': secretKey,
      };

      const [accRes, clockRes] = await Promise.all([
        fetch(`${baseUrl}/v2/account`, { headers }),
        fetch(`${baseUrl}/v2/clock`, { headers }),
      ]);

      accountOk = accRes.ok;
      clockOk = clockRes.ok;

      if (accountOk) accountData = await accRes.json() as Record<string, unknown>;
      if (clockOk) clockData = await clockRes.json() as Record<string, unknown>;
    } catch {
      // Connectivity check failed — return what we know
      return NextResponse.json({
        configured: true,
        connected: false,
        environment,
        message: 'Unable to reach Alpaca API',
      });
    }

    return NextResponse.json({
      configured: true,
      connected: accountOk,
      environment,
      environmentUrl: baseUrl,
      // WS auth payload — loaded into client memory for streaming
      wsAuth: {
        key: keyId,
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
      marketOpen: clockData
        ? (clockData as { is_open: boolean }).is_open
        : false,
    });
  } catch (err) {
    console.error('[Session API] Error:', err);
    return NextResponse.json(
      { configured: false, connected: false, message: String(err) },
      { status: 500 }
    );
  }
}
