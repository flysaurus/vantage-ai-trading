// ─── Canonical Domain Redirect ───────────────────────────────
// Redirects ALL requests from non-canonical Vercel aliases
// (flysaurus-projects preview URLs, etc.) to the canonical
// production domain.
//
// This protects against:
// - Old magic link emails with stale aliases
// - Shared links or bookmarks using preview URLs
// - Vercel auto-generated aliases leaking into auth flows
// - Any domain mismatch that could break cookie-based auth
//
// The 308 redirect preserves the full path and query params
// (including auth callback codes, tokens, and pending actions).

import { NextRequest, NextResponse } from 'next/server';

const CANONICAL_HOST = 'vantage-ai-trading.vercel.app';

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // strip port for local dev

  // Allow localhost and the canonical domain
  if (hostname === CANONICAL_HOST || hostname === 'localhost' || hostname === '127.0.0.1') {
    return NextResponse.next();
  }

  // Redirect to canonical domain, preserving path + query
  const url = new URL(request.url);
  url.host = CANONICAL_HOST;
  url.port = '';

  return NextResponse.redirect(url, 308);
}

// Match all routes EXCEPT Next.js internal paths, static assets,
// and API routes that might be called by Vercel itself.
export const config = {
  matcher: [
    // Match everything except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|api/health).*)',
  ],
};
