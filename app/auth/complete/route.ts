import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient as createServiceClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
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

  const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !session) {
    console.error('[auth/complete] exchange failed:', error?.message);
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  console.log('[auth/complete] session ok:', session.user.id);

  const serviceClient = createServiceClient();

  // Check if returning user
  const { data: existingUser } = await (serviceClient as any)
    .from('users')
    .select('demo_start_at, connection_type')
    .eq('id', session.user.id)
    .maybeSingle();

  if (existingUser?.demo_start_at || existingUser?.connection_type) {
    console.log('[auth/complete] returning user, skipping setup');
    return NextResponse.redirect(`${origin}/`);
  }

  // New user setup
  const meta = session.user.user_metadata;

  const { error: upsertError } = await (serviceClient as any)
    .from('users')
    .upsert(
      {
        id: session.user.id,
        email: session.user.email,
        first_name: meta.first_name ?? '',
        last_name: meta.last_name ?? '',
        investor_style: meta.investor_style ?? null,
        risk_tolerance: meta.risk_tolerance ?? null,
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

  if (meta.pending_choice === 'demo') {
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const { error: demoError } = await (serviceClient as any)
      .from('users')
      .update({
        demo_start_at: new Date().toISOString(),
        demo_expires_at: expiresAt,
        tier: 'demo',
      })
      .eq('id', session.user.id);

    if (demoError) {
      console.error('[auth/complete] demo error:', demoError.message);
    } else {
      console.log('[auth/complete] demo started');
    }
  } else if (meta.pending_choice === 'broker') {
    await (serviceClient as any)
      .from('users')
      .update({
        connection_type: meta.pending_connection_type,
        connection_status: 'pending',
        connection_initiated_at: new Date().toISOString(),
      })
      .eq('id', session.user.id);
  }

  // Build redirect response with cookies
  const redirectResponse = NextResponse.redirect(`${origin}/you-are-in`);

  // Copy all cookies to redirect response
  // so they persist through the navigation
  cookieStore.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie.name, cookie.value, {
      path: '/',
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });
  });

  console.log('[auth/complete] setup complete');
  return redirectResponse;
}
