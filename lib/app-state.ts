// ─── App State Machine ──────────────────────────────────────
// Single source of truth for auth-driven routing.
//
// States:
//   loading         → checking session (show loading UI)
//   onboarding      → no session (show onboarding flow)
//   authenticated   → has session + full profile (show MainApp)
//   needs-profile   → has session, no profile yet (Google OAuth edge case)
//
// All routing decisions flow from this one hook.
// No other component checks auth directly.
// No middleware session checks — those caused React #310 loops.

'use client';

import { useState, useEffect } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase';

// ── Types ───────────────────────────────────────────────────

export type AppState = 'loading' | 'onboarding' | 'authenticated' | 'needs-profile';

export interface UserProfile {
  id: string;
  investor_style: string | null;
  risk_tolerance: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface AppStateResult {
  state: AppState;
  user: SupabaseUser | null;
  profile: UserProfile | null;
}

// ── Hook ───────────────────────────────────────────────────

export function useAppState(): AppStateResult {
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    // createClient() must be called in-browser only (throws during SSR).
    // This is safe inside useEffect which only runs client-side.
    const supabase = createClient();

    async function initialize() {
      try {
        // ── Get session ─────────────────────────────────
        const { data: { session } } = await supabase.auth.getSession();

        if (cancelled) return;

        if (!session) {
          setState('onboarding');
          setUser(null);
          setProfile(null);
          return;
        }

        setUser(session.user);

        // ── Get profile ─────────────────────────────────
        const { data: rawProfile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (cancelled) return;

        const profileData = rawProfile as UserProfile | null;

        if (!profileData?.investor_style) {
          setState('needs-profile');
          setProfile(profileData);
          return;
        }

        setProfile(profileData);
        setState('authenticated');
      } catch (err) {
        // Auth check failed — most likely network error or Supabase unavailable.
        // Redirect to onboarding so the user isn't stuck on the splash forever.
        console.error('[useAppState] Auth check failed:', err);
        if (!cancelled) {
          setState('onboarding');
          setUser(null);
          setProfile(null);
        }
      }
    }

    initialize();

    // ── Listen for auth changes ───────────────────────
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        if (!session) {
          if (!cancelled) {
            setState('onboarding');
            setUser(null);
            setProfile(null);
          }
          return;
        }

        // Re-run full check on auth change
        await initialize();
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []); // Run once on mount (createClient creates fresh instance, no stable ref needed)

  return { state, user, profile };
}
