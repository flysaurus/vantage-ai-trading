// ─── GET /auth/complete ─────────────────────────────────────
// Email confirmation callback. Handles TWO auth flows:
//
// 1. PKCE (legacy / fallback):
//    URL has ?code=xxx → exchangeCodeForSession(code)
//    Uses code_verifier cookie set during signUp().
//
// 2. Implicit (current default):
//    Supabase redirects with tokens in URL hash fragment.
//    Hash fragments don't reach the server, so we serve an
//    HTML page that extracts tokens from the hash, moves them
//    to query params, and reloads. The server then reads
//    access_token + refresh_token from query params and calls
//    setSession().
//
// After auth, user setup runs (create record, demo/broker setup).

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient as createServiceClient } from '@/lib/supabase';

// ── HTML fallback page (hash extraction for implicit flow) ──

function hashExtractorHtml(origin: string): string {
  return `<!DOCTYPE html>
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
    // No hash at all — redirect to login
    window.location.href = '${origin}/login?error=callback_failed';
    return;
  }
  var params = new URLSearchParams(hash);
  var accessToken = params.get('access_token');
  var refreshToken = params.get('refresh_token');
  var type = params.get('type');
  if (accessToken && refreshToken) {
    // Move tokens from hash to query params for server processing
    var url = new URL(window.location.href);
    url.hash = '';
    url.searchParams.set('access_token', accessToken);
    url.searchParams.set('refresh_token', refreshToken);
    if (type) url.searchParams.set('type', type);
    url.searchParams.set('_flow', 'implicit');
    window.location.replace(url.toString());
  } else {
    window.location.href = '${origin}/login?error=callback_failed';
  }
})();
</script>
</body>
</html>`;
}

// ── User setup (runs after session is established) ──────────

async function handleUserSetup(
  userId: string,
  email: string | undefined,
  userMeta: Record<string, any>,
  origin: string,
): Promise<NextResponse> {
  const serviceClient = createServiceClient();

  // Check if returning user
  const { data: existingUser } = await (serviceClient as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', userId)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user, skipping setup');
    return NextResponse.redirect(`${origin}/`);
  }

  // New user setup
  const { error: upsertError } = await (serviceClient as any)
    .from('users')
    .upsert(
      {
        id: userId,
        email,
        first_name: userMeta.first_name ?? '',
        last_name: userMeta.last_name ?? '',
        investor_style: userMeta.investor_style ?? null,
        risk_tolerance: userMeta.risk_tolerance ?? null,
        investor_style_onboarded: true,
        tier: 'demo',
        first_open: new Date().toISOString(),
        last_login_at: new Date().toISOString(),
      },
      {
        onConflict: 'id',
        ignoreDuplicates: false,
      },
    );

  if (upsertError) {
    console.error('[auth/complete] upsert error:', upsertError.message);
  } else {
    console.log('[auth/complete] user record created');
  }

  if (userMeta.pending_choice === 'demo') {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: demoError } = await (serviceClient as any)
      .from('users')
      .update({
        demo_start_at: new Date().toISOString(),
        demo_expires_at: expiresAt,
        tier: 'demo',
      })
      .eq('id', userId);

    if (demoError) {
      console.error('[auth/complete] demo error:', demoError.message);
    } else {
      console.log('[auth/complete] demo started');
    }
  } else if (userMeta.pending_choice === 'broker') {
    await (serviceClient as any)
      .from('users')
      .update({
        connection_type: userMeta.pending_connection_type,
        connection_status: 'pending',
        connection_initiated_at: new Date().toISOString(),
      })
      .eq('id', userId);
  }

  console.log('[auth/complete] setup complete');
  return NextResponse.redirect(`${origin}/you-are-in`);
}

// ── GET handler ─────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const accessToken = url.searchParams.get('access_token');
  const refreshToken = url.searchParams.get('refresh_token');
  const flow = url.searchParams.get('_flow');
  const { origin } = url;

  const cookieStore = await cookies();

  // ── Case 1: PKCE flow (?code=xxx) ─────────────────────
  if (code && flow !== 'implicit') {
    if (!code) {
      return NextResponse.redirect(`${origin}/login?error=no_code`);
    }

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

    const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error || !session) {
      console.error('[auth/complete] exchange failed:', error?.message);
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }

    console.log('[auth/complete] session ok (PKCE):', session.user.id);

    const response = await handleUserSetup(
      session.user.id,
      session.user.email,
      session.user.user_metadata ?? {},
      origin,
    );

    // Copy cookies to redirect response
    cookieStore.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
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

    const { data: { session }, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (error || !session) {
      console.error('[auth/complete] setSession failed:', error?.message);
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }

    console.log('[auth/complete] session ok (implicit):', session.user.id);

    const response = await handleUserSetup(
      session.user.id,
      session.user.email,
      session.user.user_metadata ?? {},
      origin,
    );

    // Copy cookies to redirect response
    cookieStore.getAll().forEach((cookie) => {
      response.cookies.set(cookie.name, cookie.value, {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
      });
    });

    return response;
  }

  // ── Case 3: Hash-based tokens (implicit flow, first arrival) ──
  // Tokens are in the URL hash, invisible to the server.
  // Serve an HTML page that extracts them and reloads.
  return new NextResponse(hashExtractorHtml(origin), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
