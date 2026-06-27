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
import { getDemoStatus } from '@/lib/demo-utils';

// ── Types ───────────────────────────────────────────────────

export type AppState =
  | 'loading'
  | 'onboarding'
  | 'authenticated'
  | 'needs-profile'
  | 'needs-quiz'
  | 'broker-selection'
  | 'demo-expired';

export interface UserProfile {
  id: string;
  investor_style: string | null;
  risk_tolerance: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  demo_start_at: string | null;
  demo_expires_at: string | null;
  connection_type: string | null;
  connection_status: string | null;
  connection_initiated_at: string | null;
  last_login_at: string | null;
  tier_upgraded_at: string | null;
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
        // Step 1: Try user_profiles (look up by id — the PK, not user_id)
        const { data: profileData, error } = await (supabase
          .from('user_profiles') as any)
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (!mounted) return;

        console.log('[useAppState] user_profiles:', profileData, 'error:', error);

        // Step 2: If user_profiles has full data → authenticated
        if (profileData?.investor_style) {
          console.log('[useAppState] Full profile in user_profiles → authenticated');

          // ── Demo routing: check if broker selection or demo-expired ──
          const { data: userData } = await (supabase.from('users') as any)
            .select('demo_start_at, demo_expires_at, connection_type, connection_status, connection_initiated_at, last_login_at, tier_upgraded_at')
            .eq('id', session.user.id)
            .maybeSingle();

          const mergedProfile = {
            ...(profileData as Record<string, unknown>),
            demo_start_at: userData?.demo_start_at ?? null,
            demo_expires_at: userData?.demo_expires_at ?? null,
            connection_type: userData?.connection_type ?? null,
            connection_status: userData?.connection_status ?? null,
            connection_initiated_at: userData?.connection_initiated_at ?? null,
            last_login_at: userData?.last_login_at ?? null,
            tier_upgraded_at: userData?.tier_upgraded_at ?? null,
          };
          setProfile(mergedProfile as UserProfile);

          // demo_start_at column may not exist yet → null/missing = no demo started
          if (!userData?.demo_start_at) {
            console.log('[useAppState] No demo_start_at → broker selection');
            setState('broker-selection');
            return;
          }

          const demoStatus = getDemoStatus(
            userData.demo_start_at,
            userData.demo_expires_at
          );
          if (demoStatus.isExpired) {
            console.log('[useAppState] Demo expired → demo-expired');
            setState('demo-expired');
            return;
          }

          setState('authenticated');
          return;
        }

        // Step 3: Check OLD users table (pre-Prompt 5 accounts)
        // These accounts have data in 'users' but not 'user_profiles'
        console.log('[useAppState] Checking legacy users table...');
        const { data: legacyUser } = await (supabase
          .from('users') as any)
          .select('*')
          .eq('id', session.user.id)
          .single();

        console.log('[useAppState] legacy users table:', legacyUser);

        if (legacyUser?.investor_style) {
          console.log(
            '[useAppState] Found style in legacy users table:',
            legacyUser.investor_style,
          );

          // Backfill user_profiles from legacy data
          const profileToUpsert = {
            id: session.user.id,
            first_name: legacyUser.display_name?.split(' ')[0] || '',
            last_name: legacyUser.display_name?.split(' ').slice(1).join(' ') || '',
            investor_style: legacyUser.investor_style,
            risk_tolerance: legacyUser.investor_style ? 'moderate' : null,
            tier: 'demo',
            first_open: legacyUser.created_at || new Date().toISOString(),
            demo_start_at: null,  // legacy users see broker selection
            demo_expires_at: null,
            connection_type: null,
            connection_status: null,
            connection_initiated_at: null,
            last_login_at: null,
            tier_upgraded_at: null,
          };

          // Ensure users parent row exists (FK constraint)
          const { data: existingU } = await (supabase.from('users') as any)
            .select('id').eq('id', session.user.id).maybeSingle();
          if (!existingU) {
            await (supabase.from('users') as any).insert({
              id: session.user.id,
              email: legacyUser.email || session.user.email,
            });
          }

          await (supabase.from('user_profiles') as any).upsert(
            profileToUpsert,
            { onConflict: 'id' },
          );

          console.log('[useAppState] Backfilled user_profiles from legacy → authenticated');
          setProfile({ ...profileToUpsert, email: '' } as UserProfile);
          // Legacy users: no demo_start_at → broker selection
          setState('broker-selection');
          return;
        }

        // Step 4: No style anywhere — try auth metadata fallback
        const meta = session.user.user_metadata as
          | Record<string, string>
          | undefined;

        if (meta?.investor_style) {
          console.log('[useAppState] Found style in auth metadata, creating profile');

          // Ensure users parent row exists
          await (supabase.from('users') as any).upsert(
            { id: session.user.id, email: session.user.email },
            { onConflict: 'id' },
          );

          await (supabase.from('user_profiles') as any).upsert(
            {
              id: session.user.id,
              first_name: meta.first_name || meta.given_name || '',
              last_name: meta.last_name || meta.family_name || '',
              investor_style: meta.investor_style,
              risk_tolerance: meta.risk_tolerance || 'moderate',
              tier: 'demo',
              first_open: new Date().toISOString(),
              demo_expires_at: new Date(
                Date.now() + 30 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
            { onConflict: 'id' },
          );

          // Auth metadata fallback: no demo_start_at → broker selection
          setState('broker-selection');
          return;
        }

        // Step 5: user_profiles exists but no investor_style → needs quiz
        if (profileData) {
          console.log('[useAppState] Profile exists, no style → needs-quiz');
          setState('needs-quiz');
          return;
        }

        // Step 6: Truly no profile at all → needs full onboarding
        console.log('[useAppState] No profile anywhere → needs-profile');
        setState('needs-profile');
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
