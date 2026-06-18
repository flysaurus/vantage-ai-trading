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
//
// Error handling: returns an in-app error page (never redirects
// to a password-based login — this app is magic-link-only).

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/auth/supabase-server';
import { createServerClient } from '@/lib/supabase';
import { getOrCreateProfile } from '@/lib/auth/session';
import { verifyAnonId } from '@/lib/auth/magic-link';
import { generateSessionToken, hashSessionToken } from '@/lib/crypto';

const ANON_COOKIE = 'vantage-anon-id';
const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://vantage-ai-trading.vercel.app';

// ─── HTML error page (in-app, no redirects to password pages) ─

function errorPage(title: string, message: string, email?: string, detail?: string): NextResponse {
  const resendUrl = email
    ? `${APP_URL}/api/auth/send-magic-link`
    : null;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no"/>
<title>${title} · Vantage</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f172a; color: #e2e8f0;
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  .card {
    background: #1e293b; border: 1px solid #334155; border-radius: 16px;
    padding: 40px 32px; max-width: 400px; width: 100%; text-align: center;
  }
  .icon { font-size: 48px; margin-bottom: 16px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #f1f5f9; }
  p { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 24px; }
  .btn {
    display: inline-block; padding: 12px 24px; border-radius: 8px;
    font-size: 14px; font-weight: 600; text-decoration: none;
    cursor: pointer; transition: all .2s; border: none;
  }
  .btn-primary {
    background: linear-gradient(135deg, #06b6d4, #0d9488);
    color: #fff; margin: 0 6px 12px;
  }
  .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
  .btn-secondary {
    background: #334155; color: #e2e8f0; margin: 0 6px 12px;
    border: 1px solid #475569;
  }
  .btn-secondary:hover { border-color: #06b6d4; }
  .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
  .resend-status { font-size: 13px; margin-top: 12px; min-height: 20px; color: #22c55e; }
  .resend-status.error { color: #f87171; }
</style>
</head>
<body>
<div class="card">
  <div class="icon">${title.includes('Expired') ? '⏰' : title.includes('Missing') ? '🔗' : '⚠️'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
  ${detail ? `<p style="font-size:12px;color:#64748b;margin-top:-16px;margin-bottom:20px;font-family:monospace;word-break:break-all;">${detail}</p>` : ''}
  <div class="actions">
    <a href="/" class="btn btn-primary">Go to Vantage</a>
    <a href="${APP_URL}" class="btn btn-secondary">Request New Link</a>
  </div>
  ${email ? `<div id="resend-status" class="resend-status"></div>
  <script>
    (function() {
      const statusEl = document.getElementById('resend-status');
      const btns = document.querySelectorAll('.btn-secondary');
      btns.forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.preventDefault();
          statusEl.textContent = 'Resending...';
          statusEl.className = 'resend-status';
          fetch('${resendUrl}', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: '${email}' })
          }).then(function(r) {
            if (r.ok) {
              statusEl.textContent = '✅ Magic link sent! Check your inbox.';
              statusEl.className = 'resend-status';
            } else {
              statusEl.textContent = '❌ Failed to resend. Please try from the app.';
              statusEl.className = 'resend-status error';
            }
          }).catch(function() {
            statusEl.textContent = '❌ Unable to resend. Open Vantage to request a new link.';
            statusEl.className = 'resend-status error';
          });
        });
      });
    })();
  </script>` : ''}
</div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestUrl = new URL(req.url);
  console.log('[callback] Magic link callback received');

  try {
    // ── 1. Exchange code for session (or use existing session) ─
    const code = requestUrl.searchParams.get('code');
    const errorParam = requestUrl.searchParams.get('error');
    const pendingAction = requestUrl.searchParams.get('pending_action');
    const quizComplete = requestUrl.searchParams.get('quiz_complete') === '1';
    const quizStyle = requestUrl.searchParams.get('investor_style');
    const anonIdFromUrl = requestUrl.searchParams.get('anon_id') || '';
    const emailFromUrl = requestUrl.searchParams.get('email') || '';
    const next = pendingAction
      ? `/?pending_action=${encodeURIComponent(pendingAction)}`
      : (requestUrl.searchParams.get('next') || '/');

    // Handle error forwarded from /auth/confirm
    if (errorParam && !code) {
      console.error('[callback] Error forwarded from /auth/confirm:', errorParam);
      const isExpired = errorParam.toLowerCase().includes('expired');
      const isUsed = errorParam.toLowerCase().includes('already') || errorParam.toLowerCase().includes('used');

      if (isExpired) {
        return errorPage('Link Expired', 'This magic link has expired. For security, magic links are only valid for a short time.', emailFromUrl, errorParam);
      }
      if (isUsed) {
        return errorPage('Link Already Used', 'This magic link has already been used.', emailFromUrl, errorParam);
      }
      return errorPage('Authentication Failed', 'We couldn\'t verify your magic link.', emailFromUrl, errorParam);
    }

    const supabase = await getSupabaseServerClient();
    let authUser;

    if (code) {
      // ── Case A: code param present → exchange for session ──
      console.log('[callback] Exchanging code for session...');
      const { data: sessionData, error: tokenError } = await supabase.auth.exchangeCodeForSession(code);

      if (tokenError || !sessionData?.user) {
        console.error('[callback] Token exchange failed:', tokenError?.message);
        const errMsg = tokenError?.message || 'auth_failed';
        const isExpired = errMsg.toLowerCase().includes('expired');
        const isUsed = errMsg.toLowerCase().includes('already been used') || errMsg.toLowerCase().includes('already used');

        if (isExpired) {
          return errorPage('Link Expired', 'This magic link has expired. For security, magic links are only valid for a short time.', emailFromUrl, errMsg);
        }
        if (isUsed) {
          return errorPage('Link Already Used', 'This magic link has already been used. If you\'re already signed in on another device, you\'re all set — head to Vantage.', emailFromUrl, errMsg);
        }
        return errorPage('Authentication Failed', 'We couldn\'t verify your magic link. It may have expired, been revoked, or already been used.', emailFromUrl, errMsg);
      }
      authUser = sessionData.user;
    } else {
      // ── Case B: No code → session should already exist (from /auth/confirm) ──
      console.log('[callback] No code param — checking existing session...');
      const { data: { user: existingUser }, error: sessionErr } = await supabase.auth.getUser();

      if (sessionErr || !existingUser) {
        console.error('[callback] No existing session found:', sessionErr?.message);
        return errorPage(
          'Authentication Failed',
          'Your session has expired or the magic link was incomplete. Please request a new magic link from the Vantage app.',
          emailFromUrl,
          'No code and no existing session'
        );
      }
      authUser = existingUser;
      console.log('[callback] ✅ Existing session found for:', authUser.email);
    }

    console.log('[callback] ✅ Session established for:', authUser.email);

    // ── 2. Read anonymousId from cookie (fallback: URL param) ─
    const signedAnonId = req.cookies.get(ANON_COOKIE)?.value;
    let anonymousId = anonIdFromUrl; // URL param is primary source

    if (!anonymousId && signedAnonId) {
      const verified = verifyAnonId(signedAnonId);
      if (verified) {
        anonymousId = verified;
        console.log('[callback] Anonymous ID verified from cookie:', anonymousId);
      } else {
        console.warn('[callback] Anonymous ID cookie tampered — ignoring');
      }
    }

    if (anonymousId) {
      console.log('[callback] Anonymous ID:', anonymousId.slice(0, 8) + '...');
    } else {
      console.log('[callback] No anonymous ID available');
    }

    // ── 3. Get or create profile ──────────────────────────────
    console.log('[callback] 🔍 Looking up profile — anonId:', anonymousId ? anonymousId.slice(0, 12) + '...' : 'NONE', '| userId:', authUser.id);
    const profile = await getOrCreateProfile(
      authUser.id,
      anonymousId,
      authUser.email
    );
    console.log('[callback] 📋 Profile result — id:', profile.id, '| investor_style:', profile.investorStyle, '| onboarded:', profile.investorStyleOnboarded);

    // IMPORTANT: profile.id may differ from authUser.id if the email already
    // existed in the users table (from a previous auth session). All subsequent
    // DB operations MUST use profile.id, not authUser.id.

    // ── Preserve quiz completion from anonymous session ──────
    if (quizComplete || quizStyle) {
      console.log('[callback] 🎯 Preserving quiz state — quizComplete:', quizComplete, '| quizStyle:', quizStyle, '| current profile style:', profile.investorStyle);
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (quizComplete) updates.investor_style_onboarded = true;
      if (quizStyle) updates.investor_style = quizStyle;

      const adminClient = createServerClient();
      const { error: updateErr } = await (adminClient as any)
        .from('users')
        .update(updates)
        .eq('id', profile.id);

      if (updateErr) {
        console.warn('[callback] Profile update failed (non-blocking):', updateErr.message);
      } else {
        console.log('[callback] ✅ Quiz state preserved — final investor_style in DB is now:', quizStyle || profile.investorStyle);
      }
    }

    console.log('[callback] ✅ Profile ready:', profile.email, '| style:', profile.investorStyle, '| onboarded:', profile.investorStyleOnboarded);

    // ── 4. Run anonymous data migration ───────────────────────
    if (anonymousId) {
      const adminClient = createServerClient();
      try {
        const { error: migrationError } = await (adminClient as any)
          .rpc('migrate_anonymous_data', {
            p_anonymous_id: anonymousId,
            p_user_id: profile.id,
          });

        if (migrationError) {
          console.warn('[callback] Migration RPC not available:', migrationError.message);
          console.log('[callback] Running inline migration fallback...');
          await migrateInline(adminClient, anonymousId, profile.id);
        } else {
          console.log('[callback] ✅ Anonymous data migrated via RPC');
        }
      } catch (migrationErr: any) {
        console.warn('[callback] Migration failed (non-blocking):', migrationErr.message);
        try {
          await migrateInline(adminClient, anonymousId, profile.id);
        } catch (inlineErr: any) {
          console.error('[callback] Inline migration also failed:', inlineErr.message);
        }
      }
    }

    // ── 5. Create user_sessions row (custom auth system) ─────
    const sessionToken = generateSessionToken();
    const sessionHash = hashSessionToken(sessionToken);
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

    const adminClientSession = createServerClient();
    await (adminClientSession as any)
      .from('user_sessions')
      .insert({
        user_id: profile.id,
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

    // Set the session cookie
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
    return errorPage(
      'Something Went Wrong',
      'An unexpected error occurred during authentication. Please try requesting a new magic link from the Vantage app.',
      undefined,
      err.message || String(err)
    );
  }
}

// ─── Inline Migration Fallback ────────────────────────────────
// Runs when the migrate_anonymous_data() RPC doesn't exist yet.

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

  try {
    await (adminClient)
      .from('users')
      .update({ anonymous_id: null, updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {
    // Non-critical
  }
}
