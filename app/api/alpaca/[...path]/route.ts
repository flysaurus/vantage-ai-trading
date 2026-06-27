// ⛔ DEPRECATED — USE /api/broker/proxy/[...path] INSTEAD ⛔
//
// This endpoint uses server-wide env vars (ALPACA_API_KEY_ID / ALPACA_SECRET_KEY)
// and does NOT support per-user broker credentials or multi-broker.
//
// All new code should use:  POST /api/broker/proxy/[...path]
// which supports Alpaca, Tastytrade, Schwab, E*TRADE, and IBKR via
// per-user credentials stored in Supabase Vault.
//
// Keeping this file temporarily for backwards compatibility
// during migration. Remove once all clients use /api/broker/proxy.
//
// Proxies: https://paper-api.alpaca.markets/v2/{path}

import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';

// ─── Human-readable Alpaca error translations ──────────────────
const ERROR_TRANSLATIONS: Array<{ match: RegExp; friendly: string }> = [
  // Quantity
  { match: /qty.*(?:must be|greater than|integer|positive)/i, friendly: 'Quantity must be a whole number of shares (1 or more)' },
  { match: /notional.*must be/i, friendly: 'Order value too small — try increasing the quantity or using a market order' },
  // Stop orders
  { match: /stop price.*(?:below|above).*(?:current|market|last)/i, friendly: 'Stop price is on the wrong side of the market — a sell stop must be below the current price, a buy stop must be above it' },
  { match: /stop_price.*required/i, friendly: 'A trigger/stop price is required for stop orders' },
  // Limit orders
  { match: /limit price.*(?:below|above).*(?:current|market|last)/i, friendly: 'Limit price is on the wrong side of the market — buy limits go below market, sell limits go above' },
  { match: /limit_price.*required/i, friendly: 'A limit price is required for limit/stop-limit orders' },
  // Order type validation
  { match: /invalid order type/i, friendly: 'Unsupported order type — use market, limit, stop, or stop_limit' },
  { match: /time in force.*invalid/i, friendly: 'Invalid duration — use "day" or "gtc"' },
  // Sufficiency
  { match: /insufficient.*(?:qty|quantity|shares|buying power)/i, friendly: 'Not enough buying power or shares available for this order' },
  { match: /not enough.*(?:buying power|funds|cash)/i, friendly: 'Insufficient funds — reduce the quantity or deposit more cash' },
  { match: /no short/i, friendly: 'Short selling is not available for this symbol on your account' },
  // Wash trade
  { match: /wash trade/i, friendly: 'This would trigger a wash sale (buying back within 30 days of selling). Try again after 30 days or use a different symbol' },
  // Symbols
  { match: /symbol.*(?:not found|invalid|unknown|doesn.t exist)/i, friendly: 'Symbol not recognized — check the ticker spelling' },
  { match: /asset.*not.*(?:found|tradable|available)/i, friendly: 'This symbol isn\'t tradable on Alpaca — it may be OTC, delisted, or unavailable on your plan' },
  // Market hours
  { match: /market.*(?:closed|not open)/i, friendly: 'The market is currently closed — orders will queue for the next trading session' },
  { match: /outside.*trading.*(?:hours|window)/i, friendly: 'Outside regular trading hours — try during market hours (9:30 AM–4:00 PM ET)' },
  // Order status
  { match: /order.*not.*found/i, friendly: 'Order not found — it may have already been filled or canceled' },
  { match: /cannot.*cancel.*(?:filled|executed)/i, friendly: 'This order has already been filled and can\'t be canceled' },
  { match: /cannot.*cancel.*already.*cancel/i, friendly: 'This order was already canceled' },
  // Rate limits
  { match: /too many requests/i, friendly: 'Too many requests — wait a moment and try again' },
  { match: /rate limit/i, friendly: 'Rate limit reached — slow down and try again shortly' },
];

function translateAlpacaError(raw: string): string {
  for (const { match, friendly } of ERROR_TRANSLATIONS) {
    if (match.test(raw)) return friendly;
  }
  return raw; // fall through unchanged if no match
}

function getClientHeaders(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!keyId || !secretKey) {
    throw new Error('Alpaca API keys not configured in environment');
  }

  return {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };
}

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
  // Require authentication — blocks anonymous trading/proxy access
  try {
    await requireAuth();
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { path } = await context.params;
    const pathStr = path.join('/');
    const baseUrl =
      process.env.ALPACA_ENVIRONMENT === 'live' ? ALPACA_LIVE : ALPACA_PAPER;

    // Build the target URL, preserving query params
    const url = new URL(`${baseUrl}/v2/${pathStr}`);
    req.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    const headers = getClientHeaders();
    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    // Forward request body for POST
    if (method === 'POST') {
      const body = await req.text();
      if (body) {
        fetchOptions.body = body;
      }
    }

    let res: Response;
    try {
      res = await fetch(url.toString(), fetchOptions);
    } catch (fetchErr) {
      console.error('[Alpaca Proxy] Fetch error:', fetchErr);
      return NextResponse.json(
        { error: 'Failed to reach Alpaca API', details: String(fetchErr) },
        { status: 502 }
      );
    }

    const contentType = res.headers.get('content-type') || '';
    let data: unknown;

    // 204 No Content — treat as success
    if (res.status === 204) {
      return NextResponse.json({ ok: true });
    }

    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      // Extract raw error message from Alpaca response
      const rawMsg =
        typeof data === 'object' && data !== null && 'message' in data
          ? (data as { message: string }).message
          : String(data);

      // Translate to user-friendly message
      const errMsg = translateAlpacaError(rawMsg);

      // Rate limit → return 429 with Retry-After hint
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

      // 403 with wash trade — surface the actual Alpaca message
      if (res.status === 403 && rawMsg) {
        return NextResponse.json(
          { error: errMsg },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: errMsg },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('[Alpaca Proxy] Unhandled error:', err);

    // Missing API keys
    if (err instanceof Error && err.message.includes('not configured')) {
      return NextResponse.json(
        { error: 'Alpaca not configured', message: 'API keys missing in server environment' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Internal proxy error', message: String(err) },
      { status: 500 }
    );
  }
}
