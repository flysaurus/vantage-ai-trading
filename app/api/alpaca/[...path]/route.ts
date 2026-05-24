// ─── Alpaca API Proxy ─────────────────────────────────────────
// Server-side catch-all for Alpaca REST API calls.
// NEVER exposes API keys to the client — all auth happens here.
//
// Proxies: https://paper-api.alpaca.markets/v2/{path}

import { type NextRequest, NextResponse } from 'next/server';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';

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
      // Extract error message from Alpaca response
      const errMsg =
        typeof data === 'object' && data !== null && 'message' in data
          ? (data as { message: string }).message
          : String(data);

      // Rate limit → return 429 with Retry-After hint
      if (res.status === 429) {
        const retryAfter = res.headers.get('retry-after');
        return NextResponse.json(
          { error: 'Rate limited', message: errMsg, retryAfter },
          {
            status: 429,
            headers: retryAfter ? { 'Retry-After': retryAfter } : {},
          }
        );
      }

      // 403 with wash trade — surface the actual Alpaca message
      if (res.status === 403 && errMsg) {
        return NextResponse.json(
          { error: errMsg },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { error: `Alpaca API error ${res.status}`, message: errMsg },
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
