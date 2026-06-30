// ─── GET /auth/complete — Email confirmation + setup handler ─
// User lands here after clicking the email confirmation link.
//
// Session is guaranteed here (server-side, cookie already set).
// All setup logic runs in this handler — no client-side timing issues.
//
// Flows:
//   A) Direct from Supabase: ?code=xxx → exchange → setup → 200 HTML
//   B) Via /auth/confirm: session already exists → setup → 200 HTML
//   C) Returning user: already has demo_start_at/connection_type → skip to /
//
// COOKIE STRATEGY: Return 200 HTML with a <script> that polls for
// auth cookies before navigating. Browsers can drop Set-Cookie from
// HTTP 307/302 redirect responses (well-documented race condition).
// Returning 200 OK guarantees the browser processes Set-Cookie headers.
// The JS script waits until sb-* auth cookies are present in
// document.cookie (up to 3 seconds), then navigates client-side.
// If no cookies after 3s, shows a diagnostic message with raw cookies.
//
// Next.js App Router automatically merges cookies set via cookies().set()
// into ANY returned NextResponse — no manual cookie copying needed.

import { createServerClient } from '@supabase/ssr';
import { createServerClient as createServiceClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  console.log('[auth/complete] HIT — code present:', !!code, 'origin:', origin);

  const cookieStore = await cookies();

  // Supabase SSR client — uses anon key for auth operations.
  // setAll callback writes to cookieStore; Next.js auto-merges
  // those cookies into the response returned below.
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

  // ── Flow A: Exchange code for session ─────────────────────
  if (code) {
    const { data, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError || !data?.session) {
      console.error(
        '[auth/complete] exchange failed:',
        exchangeError?.message,
      );
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }

    console.log('[auth/complete] session ok:', data.session.user.id);

    // Run setup with the newly created session
    await runSetup(data.session.user, origin, supabase);

    // Return 200 HTML with cookies auto-merged + JS cookie checker
    return htmlPage('/you-are-in', origin, cookieStore, 'Flow A (code exchange)');
  }

  // ── Flow B: No code — check for existing session ──────────
  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !session) {
    console.error('[auth/complete] No code and no session');
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  console.log('[auth/complete] Flow B session:', session.user.id);
  await runSetup(session.user, origin, supabase);

  return htmlPage('/you-are-in', origin, cookieStore, 'Flow B (existing session)');
}

// ── 200 HTML + JS cookie-check navigation ─────────────────
// Cookies are auto-merged by Next.js from cookieStore mutations.
// The JS script polls document.cookie for sb-* auth tokens,
// navigates when found, or shows diagnostic after timeout.

function htmlPage(
  destination: string,
  origin: string,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  logLabel: string,
) {
  const allCookies = cookieStore.getAll();
  const cookieNames = allCookies.map(c => c.name).join(', ');
  console.log(`[auth/complete] ${logLabel} → 200 HTML,`, allCookies.length,
    'cookies auto-merged:', cookieNames,
    '→ client-side nav to', destination);

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
  var maxTries = 15; // 15 × 200ms = 3 seconds

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
      window.location.href = '${destination}';
      return;
    }

    if (tries >= maxTries) {
      statusEl.textContent = '⏰ TIMEOUT — no auth cookies after 3s';
      statusEl.style.color = '#f44';
      cookiesEl.innerHTML = '<br>❌ No sb-* auth cookies found.<br>' +
        'Server sent: ${cookieNames.replace(/'/g, "\\'")}<br>' +
        'Browser has: ' + (cookieList || '(none)') +
        '<br><br><a href="/" style="color:#4af">Go to app</a>' +
        ' | <a href="/login" style="color:#4af">Login</a>';
      return;
    }

    setTimeout(check, 200);
  }

  // Give the browser a moment to process Set-Cookie headers before first check
  setTimeout(check, 400);
})();
</script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ── Shared setup logic ───────────────────────────────────────

async function runSetup(
  user: { id: string; email?: string; user_metadata?: Record<string, any> },
  origin: string,
  authClient: ReturnType<typeof createServerClient>,
) {
  const serviceClient = createServiceClient();
  const meta = user.user_metadata || {};

  // ── Returning user guard ──────────────────────────────────
  const { data: existingUser } = await (serviceClient as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', user.id)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user, skipping setup');
    return;
  }

  // ── Create public.users record ────────────────────────────
  const now = new Date().toISOString();

  const firstName = meta.first_name ?? '';
  const lastName = meta.last_name ?? '';

  console.log('[auth/complete] runSetup — meta:', {
    first_name: firstName,
    last_name: lastName,
    investor_style: meta.investor_style,
    pending_choice: meta.pending_choice,
    risk_tolerance: meta.risk_tolerance,
  });

  const { error: upsertError } = await (serviceClient as any)
    .from('users')
    .upsert(
      {
        id: user.id,
        email: user.email || undefined,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        investor_style: meta.investor_style ?? null,
        risk_tolerance: meta.risk_tolerance ?? null,
        investor_style_onboarded: true,
        tier: 'demo',
        first_open: now,
        last_login_at: now,
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      },
    );

  if (upsertError) {
    console.error('[auth/complete] upsert failed:', upsertError.message);
  } else {
    console.log('[auth/complete] user record created');
  }

  // ── Start demo or broker connection ───────────────────────
  const pendingChoice = meta.pending_choice || 'demo';
  const pendingConnectionType = meta.pending_connection_type ?? null;

  if (pendingChoice === 'demo') {
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { error: demoError } = await (serviceClient as any)
      .from('users')
      .update({
        demo_start_at: now,
        demo_expires_at: expiresAt,
        tier: 'demo',
      })
      .eq('id', user.id);

    if (demoError) {
      console.error('[auth/complete] demo start failed:', demoError.message);
    } else {
      console.log('[auth/complete] demo started, expires:', expiresAt);

      const investmentStyle = meta.investor_style || 'lynch';
      try {
        await seedDemoPortfolio(user.id, investmentStyle);
        console.log('[auth/complete] seeded portfolio for style:', investmentStyle);
      } catch (seedErr) {
        console.warn('[auth/complete] seed warning (non-fatal):', seedErr);
      }
    }
  } else if (pendingChoice === 'broker') {
    const { error: connectionError } = await (serviceClient as any)
      .from('users')
      .update({
        connection_type: pendingConnectionType,
        connection_status: 'pending',
        connection_initiated_at: now,
      })
      .eq('id', user.id);

    if (connectionError) {
      console.error(
        '[auth/complete] connection start failed:',
        connectionError.message,
      );
    }
  }

  console.log('[auth/complete] setup complete');
}
