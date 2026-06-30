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
// 2. @supabase/ssr stores session in cookieStore (via setAll callback)
// 3. Return 200 HTML with Set-Cookie headers (auto-merged by Next.js)
//    + JS script that polls for cookies before navigating
// 4. Browser processes cookies → JS script confirms → navigates to target
//
// COOKIE STRATEGY: 200 HTML with JavaScript cookie-check navigation.
// Browsers can drop Set-Cookie from HTTP redirect responses.
// 200 OK guarantees cookies are processed before the JS navigates.
// No manual cookie copying — Next.js auto-merges from cookieStore.

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

      const params = new URLSearchParams({
        error: error.message,
        email: '',
      });
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

    console.log('[confirm] ✅ Token verified — 200 HTML →', redirect_to);

    const allCookies = cookieStore.getAll();
    const cookieNames = allCookies.map(c => c.name).join(', ');
    console.log('[confirm] cookies auto-merged:', allCookies.length, cookieNames);

    const targetUrl = redirect_to.startsWith('/')
      ? redirect_to
      : new URL(redirect_to).pathname + new URL(redirect_to).search;

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vantage — almost there…</title>
<style>
  body{background:#0a0a0a;color:#fff;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0}
  p{color:rgba(255,255,255,0.6);font-size:16px;margin:0}
  .debug{font-family:monospace;font-size:11px;color:rgba(255,255,255,0.3);margin-top:12px}
</style>
</head>
<body>
<p>Taking you to Vantage…</p>
<p class="debug" id="status">waiting for cookies...</p>
<p class="debug" id="cookies"></p>
<script>
(function(){
  var statusEl = document.getElementById('status');
  var cookiesEl = document.getElementById('cookies');
  var tries = 0;
  var maxTries = 15;
  var dest = '${targetUrl}';

  function check() {
    tries++;
    var raw = document.cookie;
    var hasAuth = raw.indexOf('sb-') !== -1;
    var cookieList = raw.split(';').filter(Boolean).map(function(c) {
      return c.trim().split('=')[0];
    }).join(', ') || '(none)';

    cookiesEl.textContent = 'raw cookies: ' + (cookieList || '(none)');
    statusEl.textContent = 'try ' + tries + '/' + maxTries + ' — ' +
      (hasAuth ? 'found auth cookies, navigating...' : 'waiting...');

    if (hasAuth) {
      window.location.href = dest;
      return;
    }

    if (tries >= maxTries) {
      statusEl.textContent = '⏰ TIMEOUT — no auth cookies after 3s';
      statusEl.style.color = '#f44';
      cookiesEl.innerHTML = '<br>❌ No sb-* auth cookies found.<br>' +
        'Server sent: ${cookieNames.replace(/'/g, "\\'")}<br>' +
        'Browser has: ' + (cookieList || '(none)') +
        '<br><br><a href="' + dest + '" style="color:#4af">Go to app</a>' +
        ' | <a href="/login" style="color:#4af">Login</a>';
      return;
    }

    setTimeout(check, 200);
  }

  setTimeout(check, 400);
})();
</script>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (err: any) {
    console.error('[confirm] Unexpected error:', err.message);
    return NextResponse.redirect(
      new URL(`/auth/callback?error=${encodeURIComponent(err.message)}`, url.origin)
    );
  }
}
