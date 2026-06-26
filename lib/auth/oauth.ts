// ─── Google OAuth Flow ───────────────────────────────────────
// Client-side only. Stores onboarding profile data in both
// sessionStorage (primary) AND URL params (fallback) before
// redirecting to Google OAuth. The callback page reads from
// both sources so profile data survives even when OAuth opens
// a new browser window where sessionStorage doesn't carry over.

'use client';

import { createClient } from '@/lib/supabase';

interface PendingProfile {
  firstName: string;
  lastName: string;
  investorStyle: string;
  riskTolerance: string;
}

/**
 * Initiate Google OAuth sign-up.
 * Stores onboarding data in sessionStorage AND URL params
 * so the callback page can write user_profiles reliably.
 */
export async function signInWithGoogle(profile: PendingProfile): Promise<void> {
  // Primary: sessionStorage (works when OAuth stays in same tab)
  try {
    sessionStorage.setItem('vantage_pending_profile', JSON.stringify(profile));
  } catch (err) {
    console.error('[signInWithGoogle] Failed to store pending profile:', err);
  }

  // Backup: pass via redirectTo URL params (survives new-tab OAuth flows)
  const redirectUrl = new URL(
    `${window.location.origin}/auth/complete`,
  );
  redirectUrl.searchParams.set('fn', profile.firstName);
  redirectUrl.searchParams.set('ln', profile.lastName);
  redirectUrl.searchParams.set('style', profile.investorStyle);
  redirectUrl.searchParams.set('risk', profile.riskTolerance);

  const supabase = createClient();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl.toString(),
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    console.error('[signInWithGoogle] OAuth error:', error.message);
    throw error;
  }
}
