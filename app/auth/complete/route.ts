// ─── GET /auth/complete — Email confirmation handler ────────
// User lands here after clicking the email confirmation link.
//
// TWO possible flows:
//   A) Direct from Supabase confirmation page: ?code=xxx
//      → exchange code for session → redirect to /welcome
//   B) Via /auth/confirm (custom template, token_hash flow):
//      /auth/confirm already set the session cookie,
//      so no code param → check for session → /welcome
//
// If neither works → redirect to login with error.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

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

  // FLOW A: Exchange code for session (direct Supabase redirect)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('[auth/complete] Exchange failed:', error.message);
      return NextResponse.redirect(`${origin}/login?error=callback_failed`);
    }
    return NextResponse.redirect(`${origin}/welcome`);
  }

  // FLOW B: No code — check for existing session
  // (set by /auth/confirm via token_hash verification)
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (!sessionError && session) {
    console.log('[auth/complete] Session found (Flow B) — redirecting to welcome');
    return NextResponse.redirect(`${origin}/welcome`);
  }

  // No code, no session — give up
  console.error('[auth/complete] No code and no session');
  return NextResponse.redirect(`${origin}/login?error=no_code`);
}
