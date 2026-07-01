// ─── GET /auth/callback ──────────────────────────────────────
// Password reset / email confirmation callback.
// Handles TWO auth flows:
//
// 1. PKCE (fallback): URL has ?code=xxx → exchangeCodeForSession
// 2. Implicit (default): tokens in hash fragment → HTML extraction
//
// Query param `next` controls redirect destination after auth.
// Public route (no auth guard).

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');
  const flow = url.searchParams.get('_flow');
  const next = url.searchParams.get('next') || '/welcome';
  const { origin } = url;

  const cookieStore = await cookies();

  // ── Case 1: PKCE flow (?code=xxx) ─────────────────────
  if (code && flow !== 'implicit') {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Auth callback error:', error.message);
      return NextResponse.redirect(
        `${origin}/login?error=callback_failed`,
      );
    }

    const response = NextResponse.redirect(`${origin}${next}`);
    const allCookies = cookieStore.getAll();
    allCookies.forEach((c) => {
      response.cookies.set(c.name, c.value, {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    });

    return response;
  }

  // ── Case 2: Implicit flow (?access_token=...&refresh_token=...) ──
  if (accessToken && refreshToken) {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error) {
      console.error('Auth callback setSession error:', error.message);
      return NextResponse.redirect(
        `${origin}/login?error=callback_failed`,
      );
    }

    const response = NextResponse.redirect(`${origin}${next}`);
    const allCookies = cookieStore.getAll();
    allCookies.forEach((c) => {
      response.cookies.set(c.name, c.value, {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    });

    return response;
  }

  // ── Case 3: Hash-based tokens (implicit flow, first arrival) ──
  // Tokens are in the URL hash — invisible to server.
  // Serve an HTML page that extracts them and reloads with query params.
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vantage — signing you in…</title>
<style>
  body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
  p{color:rgba(255,255,255,0.6);font-size:16px}
</style>
</head>
<body>
<p>Signing you in…</p>
<script>
(function(){
  var hash = window.location.hash.substring(1);
  if (!hash) {
    window.location.href = '${origin}/login?error=callback_failed';
    return;
  }
  var params = new URLSearchParams(hash);
  var accessToken = params.get('access_token');
  var refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    var url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('refresh_token', refreshToken);
    url.searchParams.set('_flow', 'implicit');
    window.location.replace(url.toString());
  } else {
    window.location.href = '${origin}/login?error=callback_failed';
  }
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
