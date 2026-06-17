// ─── GET /auth/callback ──────────────────────────────────────
// Magic link callback route. User lands here after clicking
// the magic link in their email.
//
// Flow:
// 1. Exchange `code` query param for a Supabase session
// 2. Read anonymousId from the vantage-anon-id cookie
// 3. Get or create user profile (link anonymousId)
// 4. Run data migration: moves all anonymous-owned data to the
//    authenticated user via the migrate_anonymous_data() RPC
// 5. Create a user_sessions row so the existing AuthProvider
//    (which checks /api/auth/me) recognizes the user
// 6. Set the session cookie used by the custom auth middleware
// 7. Redirect to /

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/auth/supabase-server';
import { createServerClient } from '@/lib/supabase';
import { getOrCreateProfile } from '@/lib/auth/session';
import { verifyAnonId } from '@/lib/auth/magic-link';
import { generateSessionToken, hashSessionToken } from '@/lib/crypto';

const ANON_COOKIE = 'vantage-anon-id';
const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(req.url);
  console.log('[callback] Magic link callback received');

  try {
    // ── 1. Exchange code for session ──────────────────────────
    const code = requestUrl.searchParams.get('code');
    const pendingAction = requestUrl.searchParams.get('pending_action');
    const next = pendingAction
      ? `/?pending_action=${encodeURIComponent(pendingAction)}`
      : (requestUrl.searchParams.get('next') || '/');

    if (!code) {
      console.error('[callback] No code in callback URL');
      return NextResponse.redirect(new URL('/login?error=no_code', req.url));
    }

    console.log('[callback] Exchanging code for session...');
    const supabase = await getSupabaseServerClient();

    const { data: sessionData, error: tokenError } = await supabase.auth.exchangeCodeForSession(code);

    if (tokenError || !sessionData?.user) {
      console.error('[callback] Token exchange failed:', tokenError?.message);
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(tokenError?.message || 'auth_failed')}`, req.url)
      );
    }

    const authUser = sessionData.user;
    console.log('[callback] ✅ Session established for:', authUser.email);

    // ── 2. Read anonymousId from cookie ───────────────────────
    const signedAnonId = req.cookies.get(ANON_COOKIE)?.value;
    let anonymousId = '';

    if (signedAnonId) {
      const verified = verifyAnonId(signedAnonId);
      if (verified) {
        anonymousId = verified;
        console.log('[callback] Anonymous ID verified from cookie:', anonymousId);
      } else {
        console.warn('[callback] Anonymous ID cookie tampered — ignoring');
      }
    }

    // ── 3. Get or create profile ──────────────────────────────
    const profile = await getOrCreateProfile(
      authUser.id,
      anonymousId,
      authUser.email
    );
    console.log('[callback] Profile ready:', profile.email, '| style:', profile.investorStyle);

    // ── 4. Run anonymous data migration ───────────────────────
    if (anonymousId) {
      const adminClient = createServerClient();
      try {
        const { error: migrationError } = await (adminClient as any)
          .rpc('migrate_anonymous_data', {
            p_anonymous_id: anonymousId,
            p_user_id: authUser.id,
          });

        if (migrationError) {
          // RPC might not exist yet — log but don't block login
          console.warn('[callback] Migration RPC not available:', migrationError.message);
          console.log('[callback] Running inline migration fallback...');

          // Fallback: migrate known tables inline
          await migrateInline(adminClient, anonymousId, authUser.id);
        } else {
          console.log('[callback] ✅ Anonymous data migrated via RPC');
        }
      } catch (migrationErr: any) {
        console.warn('[callback] Migration failed (non-blocking):', migrationErr.message);
        try {
          await migrateInline(adminClient, anonymousId, authUser.id);
        } catch (inlineErr: any) {
          console.error('[callback] Inline migration also failed:', inlineErr.message);
        }
      }
    }

    // ── 5. Create user_sessions row (custom auth system) ─────
    const sessionToken = generateSessionToken();
    const sessionHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

    const adminClient = createServerClient();
    await (adminClient as any)
      .from('user_sessions')
      .insert({
        user_id: authUser.id,
        session_token_hash: sessionHash,
        expires_at: expiresAt,
        last_activity_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      });

    console.log('[callback] ✅ User session created');

    // ── 6. Set session cookie + redirect ─────────────────────
    const redirectResponse = NextResponse.redirect(new URL(next, req.url));

    // Clear the anonymous ID cookie
    redirectResponse.cookies.set(ANON_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    // Set the session cookie (compatible with existing /api/auth/me)
    redirectResponse.cookies.set(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE,
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

// ─── Inline Migration Fallback ────────────────────────────────
// Runs when the migrate_anonymous_data() RPC doesn't exist yet.
// Migrates data table-by-table using the service_role client.

async function migrateInline(
  adminClient: any,
  anonymousId: string,
  userId: string
): Promise<void> {
  const tablesToMigrate = [
    'chat_history',
    'chat_messages',
    'trade_history',
    'watchlists',
    'account_snapshots',
    'metrics',
    'portfolio_analysis',
    'strategies',
    'alerts',
    'ai_suggestions',
    'daily_suggestions',
    'scanner_recommendations',
  ];

  let migrated = 0;
  let skipped = 0;

  for (const table of tablesToMigrate) {
    try {
      const { data: rows } = await (adminClient)
        .from(table)
        .select('id')
        .eq('user_id', anonymousId)
        .limit(1);

      if (!rows || rows.length === 0) {
        skipped++;
        continue;
      }

      const { error } = await (adminClient)
        .from(table)
        .update({ user_id: userId })
        .eq('user_id', anonymousId);

      if (error) {
        console.warn(`[callback] Migration skipped for ${table}:`, error.message);
        skipped++;
      } else {
        console.log(`[callback] Migrated ${table}`);
        migrated++;
      }
    } catch {
      skipped++;
    }
  }

  console.log(`[callback] Inline migration complete — ${migrated} tables migrated, ${skipped} skipped`);

  // Clear the anonymous ID from users table after successful migration
  try {
    await (adminClient)
      .from('users')
      .update({ anonymous_id: null, updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    // Non-critical
  }
}
