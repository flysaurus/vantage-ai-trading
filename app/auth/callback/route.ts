// ─── GET /auth/callback ──────────────────────────────────────
// Supabase email confirmation callback.
// User lands here after clicking the confirmation link in their
// sign-up email. Exchanges the `code` for a session then redirects
// to /welcome, which handles all post-auth branching.
//
// No business logic here — only code-for-session exchange.
// Public route (no auth guard).

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/welcome';

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

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error('Auth callback error:', error.message);
    return NextResponse.redirect(
      `${origin}/login?error=callback_failed`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
