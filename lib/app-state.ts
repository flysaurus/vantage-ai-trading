// ─── App State Machine ──────────────────────────────────────
// Single source of truth for auth-driven routing.
//
// Data source: public.users (central identity table).
// No other table is queried for routing decisions.
//
// States:
//   loading              → checking session (show boot splash)
//   onboarding           → no session (show onboarding flow)
//   needs-quiz           → account exists, no investor_style
//   needs-profile        → no first_name/last_name
//   broker-selection     → edge case: has style + name, no demo/connection
//   demo-counter         → demo user logging in → show days remaining
//   connection-options   → needs to pick broker post-auth
//   connection-loading   → broker syncing
//   demo-expired         → demo_expires_at passed
//   authenticated        → full access
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
  | 'needs-quiz'
  | 'needs-profile'
  | 'broker-selection'
  | 'demo-counter'
  | 'connection-options'
  | 'connection-loading'
  | 'demo-expired'
  | 'authenticated';

export interface UserProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  investor_style: string | null;
  risk_tolerance: string | null;
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
  /** Call after state-changing API calls (e.g. demo start, broker connect)
   * to re-evaluate the state machine without a full page reload. */
  refreshState: () => void;
}

// ── Meaningful auth events ─────────────────────────────────
const MEANINGFUL_EVENTS = new Set([
  'SIGNED_IN',
  'SIGNED_OUT',
  'USER_UPDATED',
  // TOKEN_REFRESHED intentionally omitted — middleware refreshes
  // tokens passively; listening here creates PATCH → refresh → PATCH loops
]);

// ── Decision tree: resolve state from users row ────────────
//
// Called AFTER investor_style + name checks pass.
// Pure function — no side effects, no DB calls.

export function resolveStateFromUsers(
  userData: Record<string, unknown> | null
): AppState {
  // No data → broker selection (safety fallback)
  if (!userData) return 'broker-selection';

  const demoExpired = getDemoStatus(
    userData.demo_start_at as string | null,
    userData.demo_expires_at as string | null
  ).isExpired;

  // 1. demo_expires_at is set AND past now → 'demo-expired'
  if (userData.demo_expires_at && demoExpired) {
    return 'demo-expired';
  }

  const connStatus = userData.connection_status as string | null;

  // 2. connection_status = 'syncing' OR 'pending' → 'connection-loading'
  if (connStatus === 'syncing' || connStatus === 'pending') {
    return 'connection-loading';
  }

  // 3. connection_status = 'connected' → 'authenticated'
  if (connStatus === 'connected') {
    return 'authenticated';
  }

  // 4. demo_start_at is set AND demo not expired → 'demo-counter'
  if (userData.demo_start_at && !demoExpired) {
    return 'demo-counter';
  }

  const connType = userData.connection_type as string | null;

  // 5. connection_type is set (status is null/not set yet) → 'connection-options'
  if (connType) {
    return 'connection-options';
  }

  // 6. demo_start_at is NULL AND connection_type is NULL → 'broker-selection'
  if (!userData.demo_start_at && !connType) {
    return 'broker-selection';
  }

  // 7. Default → 'authenticated'
  return 'authenticated';
}

// ── Hook ───────────────────────────────────────────────────

export function useAppState(): AppStateResult {
  const supabase = getSupabaseBrowserClient();
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

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
        // ── Query public.users ONLY (central identity table) ──
        console.log('[app-state] looking up user:', {
          id: session.user.id,
          email: session.user.email,
        });

        const { data: userData, error } = await (supabase
          .from('users') as any)
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!mounted) return;

        console.log('[app-state] found user:',
          userData ? 'yes' : 'no',
          'investor_style:',
          userData?.investor_style ?? 'null');

        // No users row at all → needs onboarding
        if (!userData) {
          setState('needs-profile');
          return;
        }

        // Set profile from users data
        setProfile(userData as UserProfile);

        // ── Pre-flight checks ───────────────────────────

        // No investor_style → needs quiz
        if (!userData.investor_style) {
          setState('needs-quiz');
          return;
        }

        // No first_name OR last_name → needs profile completion
        if (!userData.first_name || !userData.last_name) {
          setState('needs-profile');
          return;
        }

        // ── Decision tree ───────────────────────────────
        const nextState = resolveStateFromUsers(
          userData as Record<string, unknown> | null
        );
        setState(nextState);

      } catch (err) {
        if (!mounted) return;
        console.error('[useAppState] State resolution error:', err);
        setState('onboarding');
      }
    }

    // Check existing session on mount / refresh
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => resolveState(session))
      .catch((err) => {
        console.error('[useAppState] getSession error:', err);
        if (mounted) setState('onboarding');
      });

    // Listen for auth changes (sign in / sign out / token refresh)
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
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── refreshState: call after state-changing API calls ──
  const refreshState = () => setRefreshKey((k) => k + 1);

  return { state, user, profile, refreshState };
}
