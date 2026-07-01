// ─── Middleware — Canonical domain + Session refresh ─────────────
// 1. Canonical domain redirect (all Vercel aliases → vantage-ai-trading.vercel.app)
// 2. Supabase session refresh — keeps cookies alive across requests on Vercel.
//    Without this, session cookies expire between page navigations and
//    getSession() returns null on subsequent loads.
//
// Session checking is also done client-side via useAppState.
// API routes handle their own auth via lib/auth/get-server-user.ts.

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CANONICAL_HOST = 'vantage-ai-trading.vercel.app';

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // strip port for local dev
  const { pathname } = request.nextUrl;

  // 1. Canonical domain redirect
  const isVercelPreview = hostname.includes('flysaurus-projects.vercel.app');

  if (
    hostname !== CANONICAL_HOST &&
    !hostname.includes('localhost') &&
    hostname !== '127.0.0.1' &&
    !isVercelPreview
  ) {
    const url = new URL(request.url);
    url.host = CANONICAL_HOST;
    url.port = '';
    return NextResponse.redirect(url, 308);
  }

  // 2. Auth callbacks — always allow through
  if (pathname.startsWith('/auth/')) {
    return NextResponse.next();
  }

  // 3. Supabase session refresh
  // This MUST be called on every request to keep the session alive.
  // Without it, the Supabase Auth cookies expire and getSession()
  // returns null.
  let response = NextResponse.next({ request });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('[middleware] Missing Supabase env vars — skipping session refresh');
      return response;
    }

    const supabase = createServerClient(
      supabaseUrl,
      supabaseKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            // IMPORTANT: Use ONLY response.cookies.set() — NOT request.cookies.set().
            // Using both creates DUPLICATE Set-Cookie headers (Next.js auto-merges
            // request.cookies.set() mutations, AND then response.cookies.set() adds
            // another header). Browsers handle duplicates unpredictably → cookies
            // silently lost.
            //
            // Session-only: strip expires/maxAge so cookies die on browser close.
            cookiesToSet.forEach(({ name, value, options }) => {
              const { expires, maxAge, ...rest } = options;
              response.cookies.set(name, value, rest);
            });
          },
        },
      }
    );

    // Refresh session — must be called on every request
    await supabase.auth.getUser();
  } catch (err) {
    console.error('[middleware] Session refresh error:', err);
    // Don't block the request — session refresh is best-effort
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
