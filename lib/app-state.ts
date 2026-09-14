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
//   connection-options   → needs to pick broker post-auth
//   connection-loading   → broker syncing
//   authenticated        → full access
//
// All routing decisions flow from this one hook.
// No other component checks auth directly.
//
// RESILIENCE (see lib/async-guards.ts): every network await here is bounded by
// a timeout and the profile fetch retries a bounded number of times. Terminal
// failure sets `stalled` — it NEVER silently becomes 'onboarding' (showing a
// signed-in user the intro flow) and NEVER leaves an endless splash.

'use client';

import { useState, useEffect } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';
import {
  AUTH_GETUSER_TIMEOUT_MS,
  ME_FETCH_TIMEOUT_MS,
  SESSION_FALLBACK_TIMEOUT_MS,
  SETUP_TIMEOUT_MS,
  fetchWithRetry,
  fetchWithTimeout,
  withTimeout,
} from '@/lib/async-guards';

// ── Types ───────────────────────────────────────────────────

export type AppState =
  | 'loading'
  | 'onboarding'
  | 'needs-quiz'
  | 'needs-profile'
  | 'broker-selection'
  | 'connection-options'
  | 'us-stock-brokers'
  | 'connection-loading'
  | 'authenticated';

export interface UserProfile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  investor_style: string | null;
  risk_tolerance: string | null;
  /** Self-reported investing familiarity ('new' | 'some' | 'experienced'), or null. */
  investment_experience?: string | null;
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
  /** TRUE when resolution stopped on a TERMINAL failure (timeout / network /
   *  exhausted retries) rather than a verdict. `state` stays `'loading'` so no
   *  other screen can claim the user — render a retry affordance, never an
   *  endless splash. Deliberately distinct from `'onboarding'`, which means
   *  "we asked the server and there is genuinely no session". */
  stalled: boolean;
  /** Human-readable reason for `stalled` (null when not stalled). */
  error: string | null;
  /** Clear the stall and re-run the whole resolution. */
  retry: () => void;
}

/** What the top-level spinner is allowed to do. */
export const STALLED_ERROR_COPY = "Couldn't reach Vantage.";

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

  const connStatus = userData.connection_status as string | null;

  // 1. connection_status = 'syncing' OR 'pending' → 'connection-loading'
  if (connStatus === 'syncing' || connStatus === 'pending') {
    return 'connection-loading';
  }

  // 2. connection_status = 'connected' → 'authenticated'
  if (connStatus === 'connected') {
    return 'authenticated';
  }

  // 3. demo_start_at is set → 'authenticated' (demo is permanent, no expiry)
  if (userData.demo_start_at) {
    return 'authenticated';
  }

  const connType = userData.connection_type as string | null;

  // 4. connection_type is set (status is null/not set yet) → 'connection-options'
  if (connType) {
    return 'connection-options';
  }

  // 5. demo_start_at is NULL AND connection_type is NULL → 'broker-selection'
  if (!userData.demo_start_at && !connType) {
    return 'broker-selection';
  }

  // 6. Default → 'authenticated'
  return 'authenticated';
}

// ── Hook ───────────────────────────────────────────────────

export function useAppState(): AppStateResult {
  const supabase = getSupabaseBrowserClient();
  const [state, setState] = useState<AppState>('loading');
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // A fresh resolve supersedes any previous stall.
      setStalled(false);
      setError(null);

      try {
        // ── Fetch user profile via server API (bypasses RLS) ──
        // Direct Supabase queries are blocked by RLS on public.users.
        // /api/auth/me uses service key server-side, so it always works.
        //
        // BOUNDED: 3 attempts, 8s each, 0/500/1500ms backoff. A hung socket can
        // no longer park this hook in 'loading' forever (the stuck-splash bug).
        console.log('[app-state] fetching profile via /api/auth/me for:', session.user.id);

        const meResult = await fetchWithRetry('/api/auth/me', { credentials: 'include' }, {
          timeoutMs: ME_FETCH_TIMEOUT_MS,
          onAttempt: (attempt, outcome) => {
            console.log(`[app-state] /api/auth/me attempt ${attempt}: ${outcome}`);
          },
        });
        if (!mounted) return;

        if (!meResult.response) {
          if (meResult.terminalStatus !== null) {
            // 4xx that is not transient (401/403) — the server's verdict is
            // "no usable session". Onboarding is the honest destination.
            console.warn('[app-state] /api/auth/me rejected the session:', meResult.terminalStatus);
            setState('onboarding');
            return;
          }
          // Timeouts / network errors / 5xx that survived every retry.
          // NEVER fall through to 'onboarding' here: a signed-in user whose
          // network blipped must not be shown the intro flow. Park in a
          // terminal, retryable state (page.tsx renders the retry affordance).
          const reason = meResult.lastError instanceof Error ? meResult.lastError.message : 'network error';
          console.error(`[app-state] /api/auth/me unreachable after ${meResult.attempts} attempt(s):`, reason);
          setError(`${STALLED_ERROR_COPY} (${reason})`);
          setStalled(true);
          return;
        }

        const { user: apiUser } = await meResult.response.json();
        if (!apiUser) {
          setState('onboarding');
          return;
        }

        if (!mounted) return;

        console.log('[app-state] /api/auth/me returned:',
          'investor_style:', apiUser.investor_style ?? 'null',
          'demo_start_at:', apiUser.demo_start_at ? 'set' : 'null');

        // ── DEBUG: temporary state machine diagnostics ──
        console.log('[app-state] raw userData:', JSON.stringify(apiUser));
        console.log('[app-state] checks:', {
          hasStyle: !!apiUser?.investor_style,
          onboarded: apiUser?.investorStyleOnboarded,
          demoStart: apiUser?.demo_start_at,
          firstName: apiUser?.first_name
        });

        // ── Auto-heal: fill missing users fields from auth metadata ──
        // Triggered when public.users is missing any key field that auth metadata has.
        let userData = apiUser;
        const meta = session.user.user_metadata || {};

        const missingStyle = !userData.investor_style && !!meta.investor_style;
        const missingName = (!userData.first_name || !userData.last_name) && (!!meta.first_name || !!meta.last_name);
        const missingDemoStart = !userData.demo_start_at && meta.pending_choice === 'demo';
        const hasAuthMeta = missingStyle || missingName || missingDemoStart;

        if (hasAuthMeta) {
          console.log('[app-state] Missing fields — auto-patching via /api/user/setup:', {
            missingStyle, missingName, missingDemoStart,
            metaStyle: meta.investor_style,
            metaName: `${meta.first_name || ''} ${meta.last_name || ''}`,
          });
          try {
            // Best-effort repair. Bounded too — this runs inside the same
            // resolution path, so an unbounded await here would reintroduce
            // the hang this file exists to prevent.
            const setupRes = await fetchWithTimeout('/api/user/setup', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                first_name: userData.first_name || meta.first_name || null,
                last_name: userData.last_name || meta.last_name || null,
                investor_style: userData.investor_style || meta.investor_style || null,
                risk_tolerance: userData.risk_tolerance || meta.risk_tolerance || null,
                demo_start_at: true, // signal to set demo_start_at if pending_choice=demo
              }),
            }, SETUP_TIMEOUT_MS);
            if (setupRes.ok) {
              // Re-fetch the now-patched record
              const refetchRes = await fetchWithTimeout('/api/auth/me', { credentials: 'include' }, SETUP_TIMEOUT_MS);
              if (refetchRes.ok) {
                const { user: fresh } = await refetchRes.json();
                if (fresh) userData = fresh;
              }
            } else {
              console.warn('[app-state] auto-patch via /api/user/setup failed:', setupRes.status);
            }
          } catch (err: any) {
            console.error('[app-state] auto-patch exception:', err.message);
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

        setState(nextState);

      } catch (err: any) {
        if (!mounted) return;
        console.error('[useAppState] State resolution error:', err);
        // An unexpected throw is a failure, not a verdict — surface it as a
        // retryable stall instead of dumping the user into onboarding.
        setError(`${STALLED_ERROR_COPY} (${err?.message || 'unexpected error'})`);
        setStalled(true);
      }
    }

    // Check existing user on mount / refresh
    (async () => {
      let sessionUser: SupabaseUser | null = null;

      try {
        const { data, error: userError } = await withTimeout(
          supabase.auth.getUser(),
          AUTH_GETUSER_TIMEOUT_MS,
          'supabase.auth.getUser',
        );
        if (userError) console.warn('[app-state] getUser error:', userError.message);
        else if (data?.user) sessionUser = data.user;
      } catch (err: any) {
        console.warn('[app-state] getUser did not settle — falling back to the local session:', err?.message);
      }

      if (!mounted) return;

      if (!sessionUser) {
        // Fallback: getUser() is a server round-trip. When it hangs, the cached
        // session in local storage is still good enough to decide what to show.
        try {
          const { data } = await withTimeout(
            supabase.auth.getSession(),
            SESSION_FALLBACK_TIMEOUT_MS,
            'supabase.auth.getSession',
          );
          if (data?.session?.user) {
            console.log('[app-state] recovered session from local storage');
            sessionUser = data.session.user;
          }
        } catch (err: any) {
          console.warn('[app-state] local-session fallback failed:', err?.message);
        }
      }

      if (!mounted) return;

      if (!sessionUser) {
        console.log('[useAppState] no session');
        setStalled(false);
        setState('onboarding');
        return;
      }

      resolveState({ user: sessionUser } as any);
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

  // ── retry: clear the stall and re-resolve from scratch ──
  const retry = () => {
    setError(null);
    setStalled(false);
    setRefreshKey((k) => k + 1);
  };

  return { state, user, profile, refreshState, stalled, error, retry };
}
