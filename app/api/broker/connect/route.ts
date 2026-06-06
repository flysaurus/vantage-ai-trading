// ─── Broker Connect Endpoint ──────────────────────────────────
// POST /api/broker/connect
//
// Accepts broker credentials from the client, validates them against
// the broker API, and if successful, encrypts + stores them in the vault.
//
// NEVER logs raw credentials. NEVER returns encrypted/decrypted keys
// to the client (beyond what's needed for session establishment).

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';
import { storeBrokerCredentials, type BrokerCredentials } from '@/lib/broker-service';
import { activateLivePortfolio } from '@/lib/portfolio-operations';

// ─── Broker API bases ─────────────────────────────────────────

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

// ─── Connectivity Verification ────────────────────────────────

async function verifyAlpaca(
  apiKey: string,
  secretKey: string,
  environment: 'paper' | 'live'
): Promise<{ ok: boolean; accountPreview?: Record<string, unknown>; error?: string }> {
  const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;

  try {
    const res = await fetch(`${baseUrl}/v2/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg =
        (body as Record<string, string>).message ||
        `Alpaca returned ${res.status}`;

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: 'Invalid API key or secret. Check your Alpaca dashboard and try again.',
        };
      }

      return { ok: false, error: msg };
    }

    const accountData = await res.json() as Record<string, unknown>;

    return {
      ok: true,
      accountPreview: {
        id: accountData.id || accountData.account_number,
        equity: accountData.equity,
        buyingPower: accountData.buying_power,
        status: accountData.status,
      },
    };
  } catch (err) {
    console.error('[Connect] Alpaca verification network error:', err);
    return { ok: false, error: 'Unable to reach Alpaca. Check your internet connection and try again.' };
  }
}

async function verifyTastytrade(
  apiKey: string,
  secretKey: string,
  environment: 'sandbox' | 'live'
): Promise<{ ok: boolean; accountPreview?: Record<string, unknown>; error?: string }> {
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

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: 'Invalid Tastytrade credentials. Check your API settings and try again.',
        };
      }

      const body = await res.json().catch(() => ({}));
      const bodyObj = body as Record<string, unknown>;
      const errorObj = bodyObj.error as Record<string, unknown> | undefined;
      const msg =
        (errorObj?.message as string) ||
        (bodyObj.message as string) ||
        `Tastytrade returned ${res.status}`;
      return { ok: false, error: msg };
    }

    const sessionData = await res.json() as Record<string, unknown>;
    const user = (sessionData.user as Record<string, unknown>) || {};
    const sessionToken = sessionData['session-token'] as string;

    // Fetch account info to get a preview
    let accountPreview: Record<string, unknown> | undefined;
    if (sessionToken) {
      try {
        const acctRes = await fetch(`${baseUrl}/customers/me/accounts`, {
          headers: {
            Authorization: sessionToken,
          },
        });
        if (acctRes.ok) {
          const acctData = await acctRes.json() as Record<string, unknown>;
          const items = (acctData.items || acctData.data) as Array<Record<string, unknown>> | undefined;
          if (items && items.length > 0) {
            const item = items[0];
            const acct = (item.account || item) as Record<string, unknown>;
            accountPreview = {
              accountNumber: acct.accountNumber || acct.account_number || item.account_number,
              externalId: acct.externalId || acct.external_id || item.external_id,
            };
          }
        }
      } catch {
        // Non-critical — just skip the preview
      }
    }

    return {
      ok: true,
      accountPreview: accountPreview || {
        email: user.email,
        username: user.username,
      },
    };
  } catch (err) {
    console.error('[Connect] Tastytrade verification network error:', err);
    return { ok: false, error: 'Unable to reach Tastytrade. Check your internet connection and try again.' };
  }
}

// ─── Route Handler ─────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { brokerId, environment, apiKey, secretKey } = body as {
      brokerId?: string;
      environment?: string;
      apiKey?: string;
      secretKey?: string;
    };

    // Validate required fields
    if (!brokerId) {
      return NextResponse.json({ error: 'brokerId is required' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }
    if (!secretKey) {
      return NextResponse.json({ error: 'secretKey is required' }, { status: 400 });
    }

    // Validate broker is supported
    if (brokerId !== 'alpaca' && brokerId !== 'tastytrade') {
      return NextResponse.json(
        { error: `Broker "${brokerId}" is not yet supported. Available: alpaca, tastytrade.` },
        { status: 400 }
      );
    }

    // Verify connectivity and get account preview
    let result: { ok: boolean; accountPreview?: Record<string, unknown>; error?: string };

    if (brokerId === 'alpaca') {
      const env = (environment === 'live' ? 'live' : 'paper') as 'paper' | 'live';
      result = await verifyAlpaca(apiKey, secretKey, env);
      if (result.ok) {
        // Store credentials in broker-service (Supabase Vault)
        const creds: BrokerCredentials = {
          provider: 'alpaca',
          alpacaApiKey: apiKey,
          alpacaSecretKey: secretKey,
          alpacaBaseUrl: env === 'live' ? ALPACA_LIVE : ALPACA_PAPER,
        };
        await storeBrokerCredentials(userId, 'alpaca', creds);
      }
    } else {
      // tastytrade
      const env = (environment === 'live' ? 'live' : 'sandbox') as 'sandbox' | 'live';
      result = await verifyTastytrade(apiKey, secretKey, env);
      if (result.ok) {
        const creds: BrokerCredentials = {
          provider: 'tastytrade',
          tastytradeApiKey: apiKey,
        };
        await storeBrokerCredentials(userId, 'tastytrade', creds);
      }
    }

    if (!result.ok) {
      return NextResponse.json(
        { connected: false, brokerId, error: result.error || 'Connection failed' },
        { status: 400 }
      );
    }

    // ── Import live portfolio data ──
    try {
      const supabase = createServerClient();
      let brokerPositions: any[] = [];
      let brokerOrders: any[] = [];

      if (brokerId === 'alpaca') {
        const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;
        const headers = {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': secretKey,
        };

        const [posRes, ordRes] = await Promise.all([
          fetch(`${baseUrl}/v2/positions`, { headers }),
          fetch(`${baseUrl}/v2/orders?status=closed&limit=100`, { headers }),
        ]);

        if (posRes.ok) {
          const alpacaPositions = await posRes.json();
          brokerPositions = (Array.isArray(alpacaPositions) ? alpacaPositions : []).map((p: any) => ({
            symbol: p.symbol,
            qty: parseInt(p.qty) || 0,
            avg_cost: parseFloat(p.avg_entry_price) || 0,
            current_price: parseFloat(p.current_price) || 0,
            market_value: parseFloat(p.market_value) || 0,
            unrealized_pnl: parseFloat(p.unrealized_pl) || 0,
            unrealized_pnl_pct: parseFloat(p.unrealized_plpc) * 100 || 0,
            sector: null,
            industry: null,
          }));
        }

        if (ordRes.ok) {
          const alpacaOrders = await ordRes.json();
          brokerOrders = (Array.isArray(alpacaOrders) ? alpacaOrders : []).map((o: any) => ({
            symbol: o.symbol,
            qty: parseInt(o.qty || o.filled_qty || 0),
            filled_qty: parseInt(o.filled_qty || 0),
            side: o.side,
            order_type: o.type || 'market',
            status: o.status || 'filled',
            filled_price: parseFloat(o.filled_avg_price || o.limit_price || 0),
            filled_at: o.filled_at || o.updated_at,
            time_in_force: o.time_in_force || 'day',
          }));
        }
      }

      if (brokerPositions.length > 0 || brokerOrders.length > 0) {
        await activateLivePortfolio(userId, brokerPositions, brokerOrders);
      }

      // Mark user as broker-connected
      await (supabase as any)
        .from('users')
        .update({ broker_connected: true })
        .eq('id', userId);
    } catch (importErr: any) {
      console.error('[Connect API] Portfolio import error:', importErr?.message || importErr);
      // Non-fatal: credentials are stored, portfolio can be re-imported via refresh
    }

    return NextResponse.json({
      connected: true,
      brokerId,
      accountPreview: result.accountPreview,
      environment,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Connect API] Unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
