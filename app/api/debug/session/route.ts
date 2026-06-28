// ─── GET /api/debug/session ────────────────────────────────
// Diagnostic: check if cookies + session are working.
// Hit this after confirming email to see what auth state looks like.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();

    const authCookies = allCookies
      .filter((c) => c.name.startsWith('sb-'))
      .map((c) => ({
        name: c.name,
        value: c.value.substring(0, 20) + '...',
      }));

    const { createServerClient } = await import('@supabase/ssr');
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    const serviceKeyPresent = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

    return NextResponse.json({
      cookieCount: allCookies.length,
      authCookies,
      user: user
        ? { id: user.id, email: user.email, role: user.role }
        : null,
      userError: userError?.message || null,
      serviceKeyPresent,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'NOT SET',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
