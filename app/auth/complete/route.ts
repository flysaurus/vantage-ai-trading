// ─── GET /auth/complete — PKCE code exchange ─────────────────
// Pure server redirect. Exchanges PKCE code for session,
// creates/updates user record, copies cookies to redirect response.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient as createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    console.error('[auth/complete] no code param, url:', request.url);
    return NextResponse.redirect(`${origin}/login?error=no_code`);
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

  // PKCE code exchange — sets sb-* cookies via cookieStore
  const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !session) {
    console.error('[auth/complete] exchange failed:', error?.message);
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  console.log('[auth/complete] session ok:', session.user.id);

  const serviceClient = createServiceClient() as any;

  // Check if returning user
  const { data: existingUser } = await serviceClient
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', session.user.id)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user');
    const response = NextResponse.redirect(`${origin}/`);
    cookieStore.getAll().forEach(({ name, value }) => {
      response.cookies.set(name, value, {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
      });
    });
    return response;
  }

  // New user setup
  const meta = session.user.user_metadata;

  await serviceClient
    .from('users')
    .upsert(
      {
        id: session.user.id,
        email: session.user.email,
        first_name: meta.first_name ?? '',
        last_name: meta.last_name ?? '',
        investor_style: meta.investor_style ?? null,
        risk_tolerance: meta.risk_tolerance ?? null,
        conc_single_pct: meta.conc_single_pct ? Number(meta.conc_single_pct) : null,
        conc_top3_pct: meta.conc_top3_pct ? Number(meta.conc_top3_pct) : null,
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

  if (meta.pending_choice === 'demo') {
    await serviceClient
      .from('users')
      .update({
        demo_start_at: new Date().toISOString(),
        demo_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        tier: 'demo',
      })
      .eq('id', session.user.id);

    console.log('[auth/complete] demo started');
  } else if (meta.pending_choice === 'broker') {
    await serviceClient
      .from('users')
      .update({
        connection_type: meta.pending_connection_type,
        connection_status: 'pending',
        connection_initiated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);
  }

  console.log('[auth/complete] setup complete');

  const response = NextResponse.redirect(`${origin}/you-are-in`);

  cookieStore.getAll().forEach(({ name, value }) => {
    response.cookies.set(name, value, {
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });
  });

  return response;
}
