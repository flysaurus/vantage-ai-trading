// ─── App State Resolver ───────────────────────────────────────
// Determines the user's app state after Supabase Auth session is confirmed.
// Checks public.users for profile, quiz results, and onboarding status.
// Used by AuthProvider to decide: needs-profile | needs-quiz | authenticated.

// ─── Profile Type ────────────────────────────────────────────

export interface AppUserProfile {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  investor_style: string | null;
  risk_tolerance: string | null;
  tier: string;
  demo_expires_at: string | null;
  first_open: string | null;
  investor_style_onboarded: boolean;
  investor_style_set_at: string | null;
  created_at: string | null;
  last_login: string | null;
}

// ─── Resolved State ──────────────────────────────────────────

export type AppState =
  | 'loading'
  | 'unauthenticated'
  | 'needs-profile'   // Has Supabase Auth but no public.users row yet
  | 'needs-quiz'      // Has users row but investor_style is null
  | 'authenticated';  // Full profile loaded

export interface ResolvedState {
  state: AppState;
  profile: AppUserProfile | null;
}

// ─── Resolve ──────────────────────────────────────────────────

/**
 * Called after Supabase Auth session is confirmed.
 * Fetches the public.users row and determines the app state.
 *
 * @param supabase - A Supabase client (can be anon or service_role)
 * @param email - The user's email from Supabase Auth
 * @returns The resolved state and profile (if found)
 */
export async function resolveState(
  supabase: { from: (table: string) => any },
  email: string,
): Promise<ResolvedState> {
  const { data: userData, error } = await supabase
    .from('users')
    .select(`
      id,
      email,
      first_name,
      last_name,
      investor_style,
      risk_tolerance,
      tier,
      demo_expires_at,
      first_open,
      investor_style_onboarded,
      investor_style_set_at,
      created_at,
      last_login
    `)
    .eq('email', email)
    .single();

  if (error || !userData) {
    // Has Supabase Auth session but no public.users row yet
    // Could happen if users insert failed during signup
    return { state: 'needs-profile', profile: null };
  }

  if (!userData.investor_style) {
    // Has account but no quiz result
    return { state: 'needs-quiz', profile: userData as AppUserProfile };
  }

  return { state: 'authenticated', profile: userData as AppUserProfile };
}
