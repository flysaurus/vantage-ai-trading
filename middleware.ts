// ─── Middleware — Minimal ───────────────────────────────────
// Does exactly two things:
//  1. Canonical domain redirect (all Vercel aliases → canonical)
//  2. Always allow /auth/* paths through for callbacks
//
// Session checking is 100% client-side via useAppState.
// Adding session checks here caused React #310 hook violation
// loops (early returns before hooks). Don't add them back.
//
// Protected API routes are left unprotected at this layer —
// each API route does its own auth via supabase.getUser().

import { NextRequest, NextResponse } from 'next/server';

const CANONICAL_HOST = 'vantage-ai-trading.vercel.app';

// Note: These are just for documentation. API routes handle
// their own authentication internally.
// const PROTECTED_ROUTES = ['/api/ai/', '/api/baskets/', '/api/alerts/'];

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // strip port for local dev
  const { pathname } = request.nextUrl;

  // 1. Canonical domain enforcement
  if (
    hostname !== CANONICAL_HOST &&
    !hostname.includes('localhost') &&
    hostname !== '127.0.0.1'
  ) {
    const url = new URL(request.url);
    url.host = CANONICAL_HOST;
    url.port = '';
    return NextResponse.redirect(url, 308);
  }

  // 2. Auth callbacks — always allow
  if (pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  // 3. All other routing handled client-side by useAppState
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
