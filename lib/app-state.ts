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
import type { User as SupabaseUser } from '@supabase/supabase-js';
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
  investor_style_onboarded: boolean;
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

    async function resolveState(session: any) {
      if (!mounted) return;

      if (!session) {
        setState('onboarding');
        setUser(null);
        setProfile(null);
        return;
      }

      setUser(session.user);

      try {
        // ── Fetch user profile via server API (bypasses RLS) ──
        // Direct Supabase queries are blocked by RLS on public.users.
        // /api/auth/me uses service key server-side, so it always works.
        console.log('[app-state] fetching profile via /api/auth/me for:', session.user.id);

        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!meRes.ok) {
          console.error('[app-state] /api/auth/me failed:', meRes.status);
          setState('onboarding');
          return;
        }

        const { user: apiUser } = await meRes.json();
        if (!apiUser) {
          setState('onboarding');
          return;
        }

        if (!mounted) return;

        console.log('[app-state] /api/auth/me returned:',
          'investor_style:', apiUser.investor_style ?? 'null',
          'demo_start_at:', apiUser.demo_start_at ? 'set' : 'null');

        // ── Auto-create: API returned no investor_style but auth metadata has it ──
        // This means the public.users record doesn't exist yet (or RLS blocked write).
        // Create it server-side via /api/user/setup.
        let userData = apiUser;
        if (!userData.investor_style) {
          const meta = session.user.user_metadata || {};
          const hasMeta = meta.investor_style || meta.first_name;
          if (hasMeta) {
            console.log('[app-state] No users record — auto-creating via /api/user/setup');
            try {
              const setupRes = await fetch('/api/user/setup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  first_name: meta.first_name || null,
                  last_name: meta.last_name || null,
                  investor_style: meta.investor_style || null,
                  risk_tolerance: meta.risk_tolerance || null,
                }),
              });
              if (setupRes.ok) {
                // Re-fetch the now-created record
                const refetchRes = await fetch('/api/auth/me', { credentials: 'include' });
                if (refetchRes.ok) {
                  const { user: fresh } = await refetchRes.json();
                  if (fresh) userData = fresh;
                }
              } else {
                console.warn('[app-state] auto-create via /api/user/setup failed:', setupRes.status);
              }
            } catch (err: any) {
              console.error('[app-state] auto-create exception:', err.message);
            }
          }
        }

        if (!mounted) return;

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
        // ── Broker-selection auto-heal ────────────────
        // If user has completed onboarding (name + style) but
        // has no demo/connection started, auto-start demo.
        // This handles edge case where pending_choice was missing
        // from user_metadata during signup.
        if (nextState === 'broker-selection' && userData.investor_style_onboarded) {
          console.log('[app-state] auto-heal: broker-selection → starting demo');
          try {
            const res = await fetch('/api/demo/start', {
              method: 'POST',
              credentials: 'include',
            });
            if (res.ok) {
              // Re-fetch the updated record via server API
              const refreshRes = await fetch('/api/auth/me', { credentials: 'include' });
              if (refreshRes.ok) {
                const { user: updated } = await refreshRes.json();
                if (updated) {
                  setProfile(updated as UserProfile);
                  setState(resolveStateFromUsers(updated as Record<string, unknown> | null));
                  return;
                }
              }
            }
            console.warn('[app-state] demo auto-start failed, falling through to broker-selection');
          } catch (err) {
            console.warn('[app-state] demo auto-start error:', err);
          }
        }

        setState(nextState);

      } catch (err) {
        if (!mounted) return;
        console.error('[useAppState] State resolution error:', err);
        setState('onboarding');
      }
    }

    // Check existing user on mount / refresh
    (async () => {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.log('[useAppState] getUser: no session');
      if (mounted) setState('onboarding');
      return;
    }
    resolveState({ user } as any);
    })();

    // Listen for auth changes (sign in / sign out)
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
