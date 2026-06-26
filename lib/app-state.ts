// ─── App State Machine ──────────────────────────────────────
// Single source of truth for auth-driven routing.
//
// States:
//   loading         → checking session (show loading UI)
//   onboarding      → no session (show onboarding flow)
//   authenticated   → has session + full profile (show MainApp)
//   needs-profile   → has session, no profile yet (Google OAuth edge case)
//   needs-quiz      → has account + profile row, but no investor_style yet
//
// All routing decisions flow from this one hook.
// No other component checks auth directly.

'use client';

import { useState, useEffect } from 'react';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// ── Types ───────────────────────────────────────────────────

export type AppState =
  | 'loading'
  | 'onboarding'
  | 'authenticated'
  | 'needs-profile'
  | 'needs-quiz';

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

      // ── DIAGNOSTIC LOGGING (remove after fix confirmed) ──
      console.log(
        '[useAppState] resolveState called, session:',
        session?.user?.email || '(null)',
      );

      if (!session) {
        console.log('[useAppState] No session → setting state to: onboarding');
        setState('onboarding');
        setUser(null);
        setProfile(null);
        return;
      }

      setUser(session.user);
      console.log('[useAppState] Session found for:', session.user.email);

      try {
        const { data: profileData, error } = await (supabase
          .from('user_profiles') as any)
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!mounted) return;

        // ── DIAGNOSTIC ─────────────────────────────────────
        console.log('[useAppState] profileData:', profileData);
        console.log('[useAppState] error:', error);
        // ───────────────────────────────────────────────────

        // ── FIX A: No user_profiles row ────────────────────
        // User signed up via old auth system (before Prompt 5)
        // and has an auth.users row but no user_profiles row.
        // Try to reconstruct from user_metadata.
        if (!profileData || error) {
          if (error?.code === 'PGRST116' || !profileData) {
            console.log(
              '[useAppState] No profile row (cause A), trying metadata fallback',
            );

            const meta = session.user.user_metadata as
              | Record<string, string>
              | undefined;

            if (meta?.investor_style) {
              console.log('[useAppState] Found style in metadata, creating profile row');

              await (supabase.from('user_profiles') as any).insert({
                id: session.user.id,
                first_name: meta.first_name || '',
                last_name: meta.last_name || '',
                investor_style: meta.investor_style,
                risk_tolerance: meta.risk_tolerance || 'moderate',
                tier: 'demo',
                first_open: new Date().toISOString(),
                demo_expires_at: new Date(
                  Date.now() + 30 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              });

              // Fetch the newly created row
              const { data: newProfile } = await (supabase
                .from('user_profiles') as any)
                .select('*')
                .eq('id', session.user.id)
                .single();

              if (newProfile) {
                console.log(
                  '[useAppState] Created profile from metadata → authenticated',
                );
                setProfile(newProfile as UserProfile);
                setState('authenticated');
                return;
              }
            }

            // Truly no profile — needs full onboarding
            console.log(
              '[useAppState] No metadata style, setting state to: needs-profile',
            );
            setState('needs-profile');
            return;
          }

          // ── FIX B: RLS/other error ──────────────────────
          console.log(
            '[useAppState] Profile fetch error (cause B?):',
            error?.code,
            error?.message,
          );
          setState('needs-profile');
          return;
        }

        // ── FIX C: Profile exists but no investor_style ────
        if (!profileData.investor_style) {
          console.log(
            '[useAppState] Profile exists but no investor_style → needs-quiz',
          );
          setState('needs-quiz');
          return;
        }

        // ── Happy path ────────────────────────────────────
        console.log('[useAppState] Full profile → authenticated');
        setProfile(profileData as UserProfile);
        setState('authenticated');
      } catch (err) {
        if (!mounted) return;
        console.error('[useAppState] Profile fetch error:', err);
        setState('onboarding');
      }
    }

    // Step 1: Check existing session
    console.log('[useAppState] Checking existing session...');
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        console.log(
          '[useAppState] getSession returned session:',
          session?.user?.email || '(null)',
        );
        resolveState(session);
      })
      .catch((err) => {
        console.error('[useAppState] getSession error:', err);
        if (mounted) setState('onboarding');
      });

    // Step 2: Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (MEANINGFUL_EVENTS.has(event)) {
        console.log(
          '[useAppState] Auth event:',
          event,
          'session:',
          session?.user?.email || '(null)',
        );
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
