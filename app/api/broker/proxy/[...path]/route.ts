// ─── Broker API Proxy (Multi-Broker) ──────────────────────────
// GET|POST|DELETE /api/broker/proxy/[...path]
//
// Broker-agnostic proxy. Determines the active broker from the vault,
// decrypts credentials for this request only, and routes to the
// correct broker API.
//
// Replaces /api/alpaca/[...path] with multi-broker support.
// Keys are discarded from memory after the request completes.
//
// Supported brokers: Alpaca, Tastytrade

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getConnectionStatus, getCredentials } from '@/lib/vault';

// ─── Broker API bases ─────────────────────────────────────────

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';
const TASTYTRADE_SANDBOX = 'https://api.cert.tastyworks.com';
const TASTYTRADE_LIVE = 'https://api.tastytrade.com';

// ─── Human-readable error translations ─────────────────────────
// Applied for both Alpaca and Tastytrade responses

const ERROR_TRANSLATIONS: Array<{ match: RegExp; friendly: string }> = [
  { match: /qty.*(?:must be|greater than|integer|positive)/i, friendly: 'Quantity must be a whole number of shares (1 or more)' },
  { match: /notional.*must be/i, friendly: 'Order value too small — try increasing the quantity or using a market order' },
  { match: /stop price.*(?:below|above).*(?:current|market|last)/i, friendly: 'Stop price is on the wrong side of the market — a sell stop must be below the current price, a buy stop must be above it' },
  { match: /stop_price.*required/i, friendly: 'A trigger/stop price is required for stop orders' },
  { match: /limit price.*(?:below|above).*(?:current|market|last)/i, friendly: 'Limit price is on the wrong side of the market — buy limits go below market, sell limits go above' },
  { match: /limit_price.*required/i, friendly: 'A limit price is required for limit/stop-limit orders' },
  { match: /invalid order type/i, friendly: 'Unsupported order type — use market, limit, stop, or stop_limit' },
  { match: /time in force.*invalid/i, friendly: 'Invalid duration — use "day" or "gtc"' },
  { match: /insufficient.*(?:qty|quantity|shares|buying power)/i, friendly: 'Not enough buying power or shares available for this order' },
  { match: /not enough.*(?:buying power|funds|cash)/i, friendly: 'Insufficient funds — reduce the quantity or deposit more cash' },
  { match: /no short/i, friendly: 'Short selling is not available for this symbol on your account' },
  { match: /wash trade/i, friendly: 'This would trigger a wash sale (buying back within 30 days of selling). Try again after 30 days or use a different symbol' },
  { match: /symbol.*(?:not found|invalid|unknown|doesn.t exist)/i, friendly: 'Symbol not recognized — check the ticker spelling' },
  { match: /asset.*not.*(?:found|tradable|available)/i, friendly: 'This symbol isn\'t tradable — it may be OTC, delisted, or unavailable on your plan' },
  { match: /market.*(?:closed|not open)/i, friendly: 'The market is currently closed — orders will queue for the next trading session' },
  { match: /outside.*trading.*(?:hours|window)/i, friendly: 'Outside regular trading hours — try during market hours (9:30 AM–4:00 PM ET)' },
  { match: /order.*not.*found/i, friendly: 'Order not found — it may have already been filled or canceled' },
  { match: /cannot.*cancel.*(?:filled|executed)/i, friendly: 'This order has already been filled and can\'t be canceled' },
  { match: /cannot.*cancel.*already.*cancel/i, friendly: 'This order was already canceled' },
  { match: /too many requests/i, friendly: 'Too many requests — wait a moment and try again' },
  { match: /rate limit/i, friendly: 'Rate limit reached — slow down and try again shortly' },
  { match: /unauthorized|unauthenticated/i, friendly: 'Broker authentication failed — your session may have expired. Try reconnecting.' },
  { match: /forbidden/i, friendly: 'Your broker account doesn\'t have permission for this action. Check your API key permissions.' },
];

function translateError(raw: string): string {
  for (const { match, friendly } of ERROR_TRANSLATIONS) {
    if (match.test(raw)) return friendly;
  }
  return raw;
}

// ─── Broker-specific request building ──────────────────────────

interface BrokerTarget {
  url: string;
  headers: Record<string, string>;
  basePath: string; // prefix to strip from the incoming path
}

async function buildAlpacaTarget(
  pathStr: string,
  method: string,
  credentials: Record<string, unknown>,
  req: NextRequest
): Promise<BrokerTarget> {
  const apiKey = String(credentials.apiKey || '');
  const secretKey = String(credentials.secretKey || '');
  const environment = String(credentials.environment || 'paper');
  const baseUrl = environment === 'live' ? ALPACA_LIVE : ALPACA_PAPER;

  // Alpaca APIs are under /v2/
  const url = new URL(`${baseUrl}/v2/${pathStr}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return {
    url: url.toString(),
    headers: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': secretKey,
      'Content-Type': 'application/json',
    },
    basePath: '/v2/',
  };
}

async function buildTastytradeTarget(
  pathStr: string,
  method: string,
  credentials: Record<string, unknown>,
  req: NextRequest
): Promise<BrokerTarget> {
  const apiKey = String(credentials.apiKey || '');
  const secretKey = String(credentials.secretKey || '');
  const environment = String(credentials.environment || 'sandbox');
  const baseUrl = environment === 'live' ? TASTYTRADE_LIVE : TASTYTRADE_SANDBOX;

  // Tastytrade API — path is used as-is (no /v2 prefix)
  const url = new URL(`${baseUrl}/${pathStr}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  return {
    url: url.toString(),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey, // Tastytrade uses login as Authorization header
    },
    basePath: '',
  };
}

// ─── Route Handlers ────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return handleRequest('GET', req, context);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return handleRequest('POST', req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  return handleRequest('DELETE', req, context);
}

async function handleRequest(
  method: string,
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> }
): Promise<NextResponse> {
  // Require authentication
  try {
    await requireAuth(req);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Determine active broker from vault
    const { userId } = await requireAuth(req);
    const status = await getConnectionStatus(userId);

    if (!status.connected || !status.brokerId) {
      return NextResponse.json(
        { error: 'No broker connected. Connect a broker in Settings.' },
        { status: 400 }
      );
    }

    // Decrypt credentials (server-side only, for this request)
    let credentials: Record<string, unknown>;
    try {
      const result = await getCredentials(userId);
      credentials = result.credentials;
    } catch {
      return NextResponse.json(
        { error: 'Failed to retrieve credentials. Please reconnect your broker.' },
        { status: 500 }
      );
    }

    const { path } = await context.params;
    const pathStr = path.join('/');

    // Build broker-specific target
    let target: BrokerTarget;
    if (status.brokerId === 'alpaca') {
      target = await buildAlpacaTarget(pathStr, method, credentials, req);
    } else if (status.brokerId === 'tastytrade') {
      target = await buildTastytradeTarget(pathStr, method, credentials, req);
    } else {
      return NextResponse.json(
        { error: `Unsupported broker: ${status.brokerId}` },
        { status: 400 }
      );
    }

    const fetchOptions: RequestInit = {
      method,
      headers: target.headers,
    };

    // Forward request body for POST
    if (method !== 'GET' && method !== 'HEAD') {
      const body = await req.text();
      if (body) {
        fetchOptions.body = body;
      }
    }

    let res: Response;
    try {
      res = await fetch(target.url, fetchOptions);
    } catch (fetchErr) {
      console.error('[Broker Proxy] Fetch error:', fetchErr);
      return NextResponse.json(
        { error: `Failed to reach ${status.brokerId} API`, details: String(fetchErr) },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type') || '';

    // 204 No Content — treat as success
    if (res.status === 204) {
      return NextResponse.json({ ok: true });
    }

    let data: unknown;
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      const rawMsg =
        typeof data === 'object' && data !== null && 'message' in data
          ? (data as { message: string }).message
          : typeof data === 'string'
          ? data
          : String(data);

      const errMsg = translateError(rawMsg);

      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        return NextResponse.json(
          { error: errMsg, retryAfter },
          {
            status: 429,
            headers: retryAfter ? { 'Retry-After': retryAfter } : {},
          }
        );
      }

      return NextResponse.json({ error: errMsg }, { status: res.status });
    }

    // IMPORTANT: Keys (credentials) are local variables scoped to this function.
    // They are eligible for garbage collection after this return statement.
    // Decrypted keys are NEVER persisted beyond a single proxy request.

    return NextResponse.json(data);
  } catch (err) {
    console.error('[Broker Proxy] Unhandled error:', err);

    if (err instanceof Error && err.message.includes('not configured')) {
      return NextResponse.json(
        { error: 'Broker not configured', message: 'API keys missing' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Internal proxy error', message: String(err) },
      { status: 500 }
    );
  }
}
