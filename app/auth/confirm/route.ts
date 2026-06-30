// ─── GET /auth/confirm ───────────────────────────────────────
// Token hash verification route. User lands here after clicking
// the custom magic link in their email.
//
// The email template uses:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}
//
// This bypasses Supabase's hosted verification page and runs
// locally, so we control the redirect flow and avoid Supabase
// Site URL auto-sync issues with Vercel preview domains.
//
// Flow:
// 1. Verify the token_hash via Supabase's verifyOtp API
// 2. @supabase/ssr stores session in cookieStore
// 3. Return 200 HTML with Set-Cookie + meta-refresh to destination
//    (avoids iOS WebView dropping cookies from 307 redirects)
// 4. Destination (/auth/complete or /auth/callback) handles setup

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') || 'email';
  const redirect_to = url.searchParams.get('redirect_to') || '/';

  console.log('[confirm] Token hash verification requested, type:', type);

  if (!token_hash) {
    console.error('[confirm] No token_hash in request');
    return NextResponse.redirect(
      new URL('/?error=missing_token', url.origin)
    );
  }

  const cookieStore = await cookies();
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

  try {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'email' | 'magiclink' | 'recovery' | 'invite',
    });

    if (error) {
      console.error('[confirm] verifyOtp failed:', error.message);

      // If expired/used, redirect to callback so it shows the proper error page
      const params = new URLSearchParams({
        error: error.message,
        email: '',
      });
      // Preserve quiz data even on error
      const callbackRedirectTo = url.searchParams.get('redirect_to');
      if (callbackRedirectTo) {
        const cbUrl = new URL(callbackRedirectTo, url.origin);
        const anonId = cbUrl.searchParams.get('anon_id');
        const quizComplete = cbUrl.searchParams.get('quiz_complete');
        const quizStyle = cbUrl.searchParams.get('investor_style');
        if (anonId) params.set('anon_id', anonId);
        if (quizComplete) params.set('quiz_complete', quizComplete);
        if (quizStyle) params.set('investor_style', quizStyle);
      }

      return NextResponse.redirect(
        new URL(`/auth/callback?${params.toString()}`, url.origin)
      );
    }

    console.log('[confirm] ✅ Token verified — redirecting via 200 HTML');

    // Return 200 HTML with cookies + meta-refresh.
    // iOS WebView (Gmail in-app browser) drops Set-Cookie from
    // HTTP 307 redirect responses. 200 OK with meta-refresh is
    // reliably handled by all browsers.
    const targetUrl = redirect_to.startsWith('/')
      ? new URL(redirect_to, url.origin)
      : new URL(redirect_to);

    const allCookies = cookieStore.getAll();
    console.log('[confirm] copying', allCookies.length, 'cookies →', targetUrl.pathname);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${targetUrl.toString()}">
<title>Vantage — redirecting…</title>
<style>body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head>
<body><p style="color:rgba(255,255,255,0.6)">Taking you to Vantage…</p></body>
</html>`;

    const response = new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    allCookies.forEach((c) => {
      response.cookies.set(c.name, c.value, {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
    });

    return response;
  } catch (err: any) {
    console.error('[confirm] Unexpected error:', err.message);
    return NextResponse.redirect(
      new URL(`/auth/callback?error=${encodeURIComponent(err.message)}`, url.origin)
    );
  }
}
