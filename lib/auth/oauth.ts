// ─── Google OAuth Flow ───────────────────────────────────────
// Client-side only. Stores onboarding profile data in
// sessionStorage before redirecting to Google OAuth.
// The callback page (/auth/complete) reads this data and
// writes user_profiles after successful OAuth login.

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
 * Stores onboarding data in sessionStorage so the callback
 * page can write user_profiles after the user returns.
 */
export async function signInWithGoogle(profile: PendingProfile): Promise<void> {
  try {
    sessionStorage.setItem(
      'vantage_pending_profile',
      JSON.stringify(profile),
    );
  } catch (err) {
    console.error('[signInWithGoogle] Failed to store pending profile:', err);
  }

  const supabase = createClient();

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/complete`,
    },
  });

  if (error) {
    console.error('[signInWithGoogle] OAuth error:', error.message);
    throw error;
  }
}
