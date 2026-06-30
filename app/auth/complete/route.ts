// ─── GET /auth/complete — Email confirmation + setup handler ─
// User lands here after clicking the email confirmation link.
//
// Session is guaranteed here (server-side, cookie already set).
// All setup logic runs in this handler — no client-side timing issues.
//
// Flows:
//   A) Direct from Supabase: ?code=xxx → exchange → setup → /you-are-in
//   B) Via /auth/confirm: session already exists → setup → /you-are-in
//   C) Returning user: already has demo_start_at/connection_type → skip to /

import { createServerClient } from '@supabase/ssr';
import { createServerClient as createServiceClient } from '@/lib/supabase';
import { seedDemoPortfolio } from '@/lib/portfolio-operations';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

// ── Helper: Return 200 HTML with cookies + client-side redirect ─
// iOS WebView (Gmail/Safari in-app browser) is unreliable with Set-Cookie
// from HTTP 302/307 redirect responses. The browser drops auth cookies
// and the user arrives at /you-are-in with no session.
//
// Workaround: return 200 OK with Set-Cookie headers + <meta refresh>.
// Browsers process Set-Cookie from 200 responses reliably, then the
// meta refresh navigates to the destination with cookies intact.
function htmlRedirect(
  destination: string,
  cookieStore: Awaited<ReturnType<typeof cookies>>,
  logLabel: string,
) {
  const allCookies = cookieStore.getAll();
  console.log(`[auth/complete] ${logLabel} → 200 HTML with`,
    allCookies.length, 'cookies:',
    allCookies.map(c => c.name).join(', '),
    '→', destination);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0;url=${destination}">
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
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  console.log('[auth/complete] HIT — code present:', !!code, 'origin:', origin);

  const cookieStore = await cookies();

  // Supabase SSR client — uses anon key for auth operations
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
    await runSetup(data.session.user, origin);

    // Return 200 HTML with cookies + meta-refresh instead of 307 redirect.
    // iOS WebView drops Set-Cookie from 307 responses (known WebKit bug).
    return htmlRedirect('/you-are-in', cookieStore, 'Flow A (code exchange)');
  }

  // ── Flow B: No code — check for existing session ──────────
  const { data: { session }, error: sessionError } =
    await supabase.auth.getSession();

  if (sessionError || !session) {
    console.error('[auth/complete] No code and no session');
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  console.log('[auth/complete] Flow B session:', session.user.id);
  await runSetup(session.user, origin);

  return htmlRedirect('/you-are-in', cookieStore, 'Flow B (existing session)');
}

// ── Shared setup logic ───────────────────────────────────────

async function runSetup(
  user: { id: string; email?: string; user_metadata?: Record<string, any> },
  origin: string,
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
    // Continue anyway — don't block user
  } else {
    console.log('[auth/complete] user record created');
  }

  // ── Start demo or broker connection ───────────────────────
  // Default to demo if no pendingChoice (user signed up without
  // completing the full onboarding flow, e.g. direct signup).
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

      // Seed style-specific starter positions ($100K total with ~15-20% invested)
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
