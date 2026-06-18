// ─── GET /auth/confirm ───────────────────────────────────────
// Token hash verification route. User lands here after clicking
// the custom magic link in their email.
//
// The email template uses:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&redirect_to={{ .RedirectTo }}
//
// This bypasses Supabase's hosted verification page and runs
// locally, so we control the redirect flow and avoid Supabase
// Site URL auto-sync issues with Vercel preview domains.
//
// Flow:
// 1. Verify the token_hash via Supabase's verifyOtp API
// 2. @supabase/ssr automatically stores session in cookies
// 3. Redirect to /auth/callback with all original params preserved
//    (quiz_complete, investor_style, anon_id, pending_action)
//    so the callback can create the user profile and migrate data.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/auth/supabase-server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const token_hash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') || 'email';
  const redirect_to = url.searchParams.get('redirect_to') || '/';

  console.log('[confirm] Token hash verification requested, type:', type);

  if (!token_hash) {
    console.error('[confirm] No token_hash in request');
    return NextResponse.redirect(
      new URL('/?error=missing_token', url.origin)
    );
  }

  try {
    const supabase = await getSupabaseServerClient();

    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as 'email' | 'magiclink' | 'recovery' | 'invite',
    });

    if (error) {
      console.error('[confirm] verifyOtp failed:', error.message);

      // If expired/used, redirect to callback so it shows the proper error page
      const params = new URLSearchParams({
        error: error.message,
        email: '',
      });
      // Preserve quiz data even on error
      const callbackRedirectTo = url.searchParams.get('redirect_to');
      if (callbackRedirectTo) {
        const cbUrl = new URL(callbackRedirectTo, url.origin);
        // Copy quiz/anonymous params to the error redirect
        const anonId = cbUrl.searchParams.get('anon_id');
        const quizComplete = cbUrl.searchParams.get('quiz_complete');
        const quizStyle = cbUrl.searchParams.get('investor_style');
        if (anonId) params.set('anon_id', anonId);
        if (quizComplete) params.set('quiz_complete', quizComplete);
        if (quizStyle) params.set('investor_style', quizStyle);
      }

      return NextResponse.redirect(
        new URL(`/auth/callback?${params.toString()}`, url.origin)
      );
    }

    console.log('[confirm] ✅ Token verified — redirecting to callback');

    // Success — redirect to the callback URL (which contains all quiz/anonymous params)
    // The session is now stored in cookies by @supabase/ssr.
    // The callback will detect the session and skip exchangeCodeForSession.
    const targetUrl = redirect_to.startsWith('/')
      ? new URL(redirect_to, url.origin)
      : new URL(redirect_to);

    return NextResponse.redirect(targetUrl);
  } catch (err: any) {
    console.error('[confirm] Unexpected error:', err.message);
    return NextResponse.redirect(
      new URL(`/auth/callback?error=${encodeURIComponent(err.message)}`, url.origin)
    );
  }
}
