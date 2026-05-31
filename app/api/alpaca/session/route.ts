// ⛔ DEPRECATED — USE /api/broker/session INSTEAD ⛔
//
// This endpoint uses server-wide env vars (ALPACA_API_KEY_ID / ALPACA_SECRET_KEY)
// and does not support per-user credentials or multi-broker.
//
// Now delegates to /api/broker/session which uses per-user credentials
// from Supabase Vault via broker-service.

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getBrokerContext } from '@/lib/broker-service';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  // Require authentication
  try {
    await requireAuth(_req);
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { userId } = await requireAuth(_req);
    const ctx = await getBrokerContext(userId);

    if (ctx.isDemo || !ctx.credentials || ctx.provider !== 'alpaca') {
      return NextResponse.json(
        {
          configured: false,
          connected: false,
          message: ctx.isDemo
            ? 'Demo mode — connect a broker in Settings first'
            : 'No Alpaca broker connected',
        },
        { status: ctx.isDemo ? 400 : 404 }
      );
    }

    const creds = ctx.credentials;
    const baseUrl = creds.alpacaBaseUrl || 'https://api.alpaca.markets';

    // Verify connectivity via broker-service (same pattern as broker/session)
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
        environment: creds.alpacaBaseUrl?.includes('paper') ? 'paper' : 'live',
        message: 'Unable to reach Alpaca API',
      });
    }

    const env = creds.alpacaBaseUrl?.includes('paper-api') ? 'paper' : 'live';

    return NextResponse.json({
      configured: true,
      connected: true,
      environment: env,
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
  } catch (err) {
    console.error('[Session API] Error:', err);
    return NextResponse.json(
      { configured: false, connected: false, message: String(err) },
      { status: 500 }
    );
  }
}
