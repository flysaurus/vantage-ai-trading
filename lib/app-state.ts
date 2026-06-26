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
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

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

// ── Meaningful auth events ─────────────────────────────────
const MEANINGFUL_EVENTS = new Set([
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
]);

// ── Hook ───────────────────────────────────────────────────

export function useAppState(): AppStateResult {
  const supabase = getSupabaseBrowserClient();
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let mounted = true;

    async function resolveState(session: Session | null) {
      if (!mounted) return;

      if (!session) {
        setState('onboarding');
        setUser(null);
        setProfile(null);
        return;
      }

      setUser(session.user);

      try {
        const { data: profileData, error } = await (supabase
          .from('user_profiles') as any)
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!mounted) return;

        if (error || !profileData) {
          // Has session but no profile
          setState('needs-profile');
          return;
        }

        if (!profileData.investor_style) {
          // Profile exists but no style (Google OAuth without onboarding)
          setState('needs-profile');
          return;
        }

        setProfile(profileData as UserProfile);
        setState('authenticated');
      } catch (err) {
        if (!mounted) return;
        console.error('[useAppState] Profile fetch error:', err);
        // Fail safe — show onboarding rather than staying stuck
        setState('onboarding');
      }
    }

    // Step 1: Check existing session
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        resolveState(session);
      })
      .catch((err) => {
        console.error('[useAppState] getSession error:', err);
        if (mounted) setState('onboarding');
      });

    // Step 2: Listen for auth changes — only on meaningful events
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (MEANINGFUL_EVENTS.has(event)) {
        resolveState(session);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { state, user, profile };
}
