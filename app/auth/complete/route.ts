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
// COOKIE DIAGNOSTIC: Returns a bright red page showing exact cookie state.
// User must click a button to continue. This makes it impossible to miss
// or "flash past" — if this page shows, you WILL see it.

import { createServerClient } from '@supabase/ssr';
import { createServerClient as createServiceClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const hasCodeParam = !!code;
  const allQueryParams = Object.fromEntries(searchParams.entries());

  console.log('[auth/complete] HIT — params:', JSON.stringify(allQueryParams),
    'has code:', hasCodeParam);

  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
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
      console.error('[auth/complete] exchange FAILED:', exchangeError?.message);
      return staticPage(origin, {
        title: '❌ Exchange Failed',
        color: '#f44',
        details: [
          `Error: ${exchangeError?.message || 'unknown'}`,
          `Code present: true (length ${code.length})`,
          `Query params: ${JSON.stringify(allQueryParams)}`,
        ],
      });
    }

    console.log('[auth/complete] ✅ exchange SUCCESS — user:', data.session.user.id);
    await runSetup(data.session.user, origin);

    const allCookies = cookieStore.getAll();
    return staticPage(origin, {
      title: '✅ Auth Complete — Cookies Set',
      color: '#0a0',
      details: [
        `Session: ${data.session.user.email}`,
        `Cookies set by server: ${allCookies.length} (${allCookies.map(c => c.name).join(', ')})`,
        `Next: click Continue → /you-are-in`,
      ],
      continueUrl: '/you-are-in',
    });
  }

  // ── Flow B: No code — check for existing session ──────────
  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !session) {
    console.error('[auth/complete] No code AND no session');
    return staticPage(origin, {
      title: '⚠️ No Code, No Session',
      color: '#f80',
      details: [
        `Query params: ${JSON.stringify(allQueryParams)}`,
        `Code param: NOT present`,
        `Session: NOT found`,
        `This means the redirect from Supabase did not include a 'code' query parameter.`,
        `Possible: tokens are in URL hash (#access_token=...) which the server can't read.`,
        `Check the URL in your browser address bar.`,
      ],
      continueUrl: '/login',
    });
  }

  console.log('[auth/complete] Flow B — existing session:', session.user.id);
  await runSetup(session.user, origin);

  const allCookies = cookieStore.getAll();
  return staticPage(origin, {
    title: '✅ Auth Complete (Existing Session)',
    color: '#0a0',
    details: [
      `Session: ${session.user.email}`,
      `Cookies set: ${allCookies.length} (${allCookies.map(c => c.name).join(', ')})`,
      `Next: click Continue → /you-are-in`,
    ],
    continueUrl: '/you-are-in',
  });
}

// ── Static HTML diagnostic page ────────────────────────────
// CANNOT be missed — bright colored, no auto-navigation, manual button.

function staticPage(
  origin: string,
  opts: {
    title: string;
    color: string;
    details: string[];
    continueUrl?: string;
  },
) {
  const detailsHtml = opts.details.map(d => `<li>${d}</li>`).join('');
  const buttonHtml = opts.continueUrl
    ? `<a href="${opts.continueUrl}" style="
      display:inline-block;margin-top:24px;padding:14px 32px;
      background:white;color:#0a0a0a;text-decoration:none;
      border-radius:8px;font-weight:700;font-size:16px;
      font-family:system-ui;
    ">Continue →</a>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Vantage — Auth Diagnostic</title>
<style>
  body{background:${opts.color};color:#fff;font-family:system-ui;
    display:flex;flex-direction:column;align-items:center;
    justify-content:center;min-height:100vh;margin:0;padding:20px}
  h1{margin:0 0 8px 0;font-size:24px}
  ul{text-align:left;max-width:600px;font-size:14px;line-height:1.8;
    background:rgba(0,0,0,0.2);padding:16px 24px;border-radius:8px;
    font-family:monospace;word-break:break-all}
  .cookie-box{margin-top:16px;padding:12px;background:rgba(0,0,0,0.3);
    border-radius:6px;font-size:12px;font-family:monospace;
    max-width:600px;width:100%;overflow-x:auto}
  .label{color:rgba(255,255,255,0.6);font-size:11px;margin:0}
</style>
</head>
<body>
<h1>${opts.title}</h1>
<ul>${detailsHtml}</ul>
<div class="cookie-box">
  <p class="label">Browser cookies (via JS):</p>
  <p id="browser-cookies" style="margin:4px 0">loading...</p>
</div>
${buttonHtml}
<script>
  document.getElementById('browser-cookies').textContent =
    document.cookie || '(empty — no cookies in browser)';
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
) {
  const serviceClient = createServiceClient();
  const meta = user.user_metadata || {};

  const { data: existingUser } = await (serviceClient as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', user.id)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user, skipping setup');
    return;
  }

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
    .upsert({
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
    }, { onConflict: 'id', ignoreDuplicates: false });

  if (upsertError) {
    console.error('[auth/complete] upsert failed:', upsertError.message);
  } else {
    console.log('[auth/complete] user record created');
  }

  const pendingChoice = meta.pending_choice || 'demo';
  const pendingConnectionType = meta.pending_connection_type ?? null;

  if (pendingChoice === 'demo') {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
      console.error('[auth/complete] connection start failed:', connectionError.message);
    }
  }

  console.log('[auth/complete] setup complete');
}
