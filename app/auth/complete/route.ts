// ─── GET /auth/complete — Email confirmation handler ────────
// User lands here after clicking the email confirmation link.
// Exchanges the code for a session, sets cookies, then redirects
// to /welcome for all post-auth business logic.
//
// ONE job only: code exchange → redirect to /welcome.
// No setup logic, no DB queries, no API calls.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    console.error('[auth/complete] No code param');
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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('[auth/complete] Exchange failed:', error.message);
    return NextResponse.redirect(`${origin}/login?error=callback_failed`);
  }

  // Success — session cookie is now set
  // Redirect to /welcome which handles all post-auth branching
  return NextResponse.redirect(`${origin}/welcome`);
}
