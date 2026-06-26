// ─── GET /auth/callback ──────────────────────────────────────
// Supabase Auth callback — handles magic link, OAuth, and email verification.
// Supabase SDK sets the session cookie automatically.
// The AuthProvider picks up the session on next page load.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/auth/supabase-server';
import { verifyAnonId } from '@/lib/auth/magic-link';
import { createServerClient } from '@/lib/supabase';

const ANON_COOKIE = 'vantage-anon-id';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(req.url);
  console.log('[callback] Auth callback received');

  try {
    const code = requestUrl.searchParams.get('code');
    const next = requestUrl.searchParams.get('next') || '/';

    if (!code) {
      console.error('[callback] No code in callback URL');
      return NextResponse.redirect(new URL('/login?error=no_code', req.url));
    }

    // Exchange code for Supabase session
    const supabase = await getSupabaseServerClient();
    const { data: sessionData, error: tokenError } = await supabase.auth.exchangeCodeForSession(code);

    if (tokenError || !sessionData?.user) {
      console.error('[callback] Code exchange failed:', tokenError?.message);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(tokenError?.message || 'auth_failed')}`, req.url)
      );
    }

    const authUser = sessionData.user;
    console.log('[callback] ✅ Session established for:', authUser.email);

    // Check for anonymous ID migration
    const signedAnonId = req.cookies.get(ANON_COOKIE)?.value;
    let anonymousId = '';
    if (signedAnonId) {
      const verified = verifyAnonId(signedAnonId);
      if (verified) {
        anonymousId = verified;
        console.log('[callback] Anonymous ID:', anonymousId);
      }
    }

    // Ensure user exists in our users table
    const adminClient = createServerClient();
    const { data: existingUser } = await (adminClient as any)
      .from('users')
      .select('id')
      .eq('id', authUser.id)
      .maybeSingle();

    if (!existingUser) {
      // First-time login — create profile row
      console.log('[callback] Creating user profile for:', authUser.email);
      await (adminClient as any)
        .from('users')
        .insert({
          id: authUser.id,
          email: authUser.email,
          first_name: authUser.user_metadata?.first_name || authUser.email?.split('@')[0] || '',
          investor_style: 'buffett',
          tier: 'demo',
          first_open: new Date().toISOString(),
          demo_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
    }

    // Migrate anonymous data if applicable
    if (anonymousId) {
      try {
        await migrateAnonymousData(adminClient, anonymousId, authUser.id);
        console.log('[callback] Anonymous data migrated');
      } catch (err: any) {
        console.warn('[callback] Migration failed (non-blocking):', err.message);
      }
    }

    // Redirect — Supabase's SSR client sets auth cookies automatically
    const redirectResponse = NextResponse.redirect(new URL(next, req.url));

    // Clear anonymous ID cookie
    redirectResponse.cookies.set(ANON_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    console.log('[callback] ✅ Redirecting to:', next);
    return redirectResponse;
  } catch (err: any) {
    console.error('[callback] Unexpected error:', err.message);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`, req.url)
    );
  }
}

// ─── Inline migration — moves anonymous data to authenticated user ──

async function migrateAnonymousData(
  adminClient: any,
  anonymousId: string,
  userId: string
): Promise<void> {
  const tablesToMigrate = [
    'chat_history', 'chat_messages', 'trade_history', 'watchlists',
    'account_snapshots', 'metrics', 'portfolio_analysis', 'strategies',
    'alerts', 'ai_suggestions', 'daily_suggestions', 'scanner_recommendations',
  ];

  for (const table of tablesToMigrate) {
    try {
      const { error } = await (adminClient)
        .from(table)
        .update({ user_id: userId })
        .eq('user_id', anonymousId);
      if (error) {
        console.warn(`[callback] Migration skipped for ${table}:`, error.message);
      }
    } catch { /* skip */ }
  }
}
