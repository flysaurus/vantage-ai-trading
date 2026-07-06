// ─── Middleware — Canonical domain + Route protection + Session refresh ──
// 1. Canonical domain redirect (all Vercel aliases → vantage-ai-trading.vercel.app)
// 2. Route protection — unauthenticated users → /login (no flash, server-side)
// 3. Supabase session refresh — keeps cookies alive across requests on Vercel.
//    Without this, session cookies expire between page navigations and
//    getSession() returns null on subsequent loads.
//
// Session checking is also done client-side via useAppState.
// API routes handle their own auth via lib/auth/get-server-user.ts.

import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const CANONICAL_HOST = 'vantage-ai-trading.vercel.app';

// Public routes — no auth needed
const PUBLIC_ROUTES = [
  '/', // root handles own routing via useAppState
  '/login',
  '/onboarding',
  '/create-account',
  '/you-are-in', // has its own auth check
  '/api/ai/facts/test', // admin-only test endpoint (uses service role internally)
  '/api/ai/weekly-snapshot/test-contradiction', // admin-only test endpoint (uses service role internally)
  '/api/ai/greeting/test-variety', // admin-only test endpoint (uses service role internally)
  '/api/ai/chat/test-deviation', // admin-only test endpoint (uses service role internally)
];

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') || '';
  const hostname = host.split(':')[0]; // strip port for local dev
  const { pathname } = request.nextUrl;

  // ═══════════════════════════════════════════════════════════════
  // 1. CANONICAL DOMAIN REDIRECT
  // ═══════════════════════════════════════════════════════════════
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

  // ═══════════════════════════════════════════════════════════════
  // 2. AUTH ROUTES — pass through
  // ═══════════════════════════════════════════════════════════════
  // /auth/* routes handle their own cookies via route handlers.
  // /auth/complete must pass through middleware WITHOUT a new
  // NextResponse so route handler cookies are preserved.
  if (pathname.startsWith('/auth/') && !pathname.startsWith('/auth/complete')) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/auth/complete')) {
    return NextResponse.next({
      request: { headers: request.headers },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. CREATE SUPABASE CLIENT
  // ═══════════════════════════════════════════════════════════════
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('[middleware] Missing Supabase env vars — skipping route protection');
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // IMPORTANT: Use ONLY response.cookies.set() — NOT request.cookies.set().
        cookiesToSet.forEach(({ name, value, options }) => {
          const { expires, maxAge, ...rest } = options;
          response.cookies.set(name, value, rest);
        });
      },
    },
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. ROUTE PROTECTION + SESSION REFRESH
  // ═══════════════════════════════════════════════════════════════
  // getUser() both refreshes the session AND returns user data.
  // Combined into one step to avoid redundant API calls.

  // Check if current path is public
  const isPublicRoute = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith('/auth/'),
  );

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Protected route + no session → /login
    if (!isPublicRoute && !user) {
      const loginUrl = new URL('/login', request.url);
      // Remember where they were trying to go
      loginUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Authenticated user hitting login/signup → redirect to app
    if (user && (pathname === '/login' || pathname === '/create-account')) {
      return NextResponse.redirect(new URL('/', request.url));
    }
  } catch (err) {
    console.error('[middleware] Session check error:', err);
    // getUser() failed (expired / invalid token) + not public → /login
    if (!isPublicRoute) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
