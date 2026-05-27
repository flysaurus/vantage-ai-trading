// ─── Auth Context Provider ────────────────────────────────────
// Supabase SDK manages session lifecycle (autoRefreshToken, persistSession).
// AuthProvider subscribes to onAuthStateChange for real-time updates.
// 10-minute inactivity timeout with 1-minute warning before logout.
//
// LOADING GUARANTEE:
//   isLoading stays true until the DB user profile is fetched and merged.
//   This eliminates the race condition where onboarding check runs before
//   investorStyleOnboarded is confirmed from the database.
//   Pages gate on isDataLoaded to ensure user data is complete.

'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  useRef,
} from 'react';
import type { User, VantageSession, InvestorStyle } from '@/types';
import { storeSession, clearSession, getUser, storeUser, clearUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

const INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes
const WARNING_BEFORE = 60 * 1000;           // warn 1 minute before logout

// ─── Context Type ─────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: VantageSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** True ONLY when DB user profile is confirmed — gates onboarding check. */
  isDataLoaded: boolean;
  /** True when the user's DB profile row doesn't exist — account invalid. */
  profileNotFound: boolean;
  /** Authentication or verification error message. */
  error: string | null;
  inactivityWarning: boolean;
  inactivityCountdown: number;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ needsConfirmation: boolean } | void>;
  signOut: () => Promise<void>;
  resendConfirmation: (email: string) => Promise<{ success: boolean; message: string }>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  isDataLoaded: false,
  profileNotFound: false,
  error: null,
  inactivityWarning: false,
  inactivityCountdown: 0,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  resendConfirmation: async () => ({ success: false, message: '' }),
});

// ─── Helpers ──────────────────────────────────────────────────

function getLocalOnboarding(): { onboarded: boolean; style: InvestorStyle } {
  if (typeof window === 'undefined') return { onboarded: false, style: 'buffett' };
  try {
    return {
      onboarded: localStorage.getItem('vantage:onboarded') === 'true',
      style: (localStorage.getItem('vantage:investorStyle') as InvestorStyle) || 'buffett',
    };
  } catch {
    return { onboarded: false, style: 'buffett' };
  }
}

function buildUser(session: Session, supabaseMeta?: Record<string, unknown>): User {
  const meta = supabaseMeta || (session.user.user_metadata as Record<string, unknown>) || {};
  const local = getLocalOnboarding();
  const cached = getUser();
  const email = session.user.email || '';
  return {
    id: session.user.id,
    email,
    displayName: (meta.display_name as string) || email.split('@')[0] || 'Trader',
    avatarUrl: meta.avatar_url as string | undefined,
    investorStyle: ((meta.investor_style as InvestorStyle) || cached?.investorStyle || local.style || 'buffett') as InvestorStyle,
    investorStyleSetAt: undefined,
    investorStyleOnboarded: !!(meta.investor_style_onboarded as boolean) || local.onboarded,
    createdAt: session.user.created_at,
  };
}

function toVantageSession(session: Session): VantageSession {
  return {
    token: session.access_token,
    expiresAt: session.expires_at || Math.floor(Date.now() / 1000) + 3600,
    userId: session.user.id,
  };
}

/**
 * Sync DB profile for a user — full initialization flow.
 * 1. Calls verify-user API (auto-creates DB row if missing, checks status).
 * 2. Fetches full user profile from /api/db/users/get.
 * 3. Merges DB values into user state (DB is source of truth).
 * Any failure → fail-closed → onProfileNotFound() → denied.
 */
async function syncUserProfile(
  u: User,
  setUser: (u: User) => void,
  mounted: () => boolean,
  onComplete: () => void,
  onProfileNotFound: () => void,
  setError: (msg: string) => void,
) {
  try {
    const { initializeAuth, getSession } = await import('@/lib/auth');

    // Step 1: Verify user exists in users table (auto-creates if missing)
    console.log('[syncUserProfile] Step 1: Verifying user in users table...');
    const verifyResult = await initializeAuth();

    if (!mounted()) return;
    console.log('[syncUserProfile] ✅ User', verifyResult.action, '| onboarded:', verifyResult.user.investorStyleOnboarded);

    // Step 2: Fetch full user profile from DB
    console.log('[syncUserProfile] Step 2: Loading user data from users table...');
    const session = getSession();
    const userDataRes = await fetch(`/api/db/users/get?id=${u.id}`, {
      headers: session?.token ? { Authorization: `Bearer ${session.token}` } : {},
    });

    if (!userDataRes.ok) {
      console.error('[syncUserProfile] ❌ Failed to load user data:', userDataRes.status);
      if (!mounted()) return;
      onProfileNotFound();
      onComplete();
      return;
    }

    const userData = await userDataRes.json();
    console.log('[syncUserProfile] ✅ User data loaded:', userData.email);

    if (!mounted()) return;

    // Step 3: Merge DB values (source of truth)
    const merged: User = {
      ...u,
      displayName: userData.displayName || u.displayName,
      avatarUrl: userData.avatarUrl || u.avatarUrl,
      investorStyle: (userData.investorStyle || u.investorStyle) as InvestorStyle,
      investorStyleOnboarded: userData.investorStyleOnboarded === true,
      investorStyleSetAt: userData.investorStyleSetAt || undefined,
    };

    setUser(merged);
    storeUser(merged);
    if (merged.investorStyleOnboarded) localStorage.setItem('vantage:onboarded', 'true');
    if (merged.investorStyle) localStorage.setItem('vantage:investorStyle', merged.investorStyle);

    console.log('[syncUserProfile] ✅ Profile merged — access granted');
    onComplete();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Authentication error. Please try again.';
    console.error('[syncUserProfile] FAIL-CLOSED — error blocking access:', msg);
    if (!mounted()) return;
    setError(msg);
    // Any error → deny access (fail-closed: inactive account, server error, network outage)
    onProfileNotFound();
    onComplete();
  }
}

// ─── Provider Component ──────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<VantageSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [profileNotFound, setProfileNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inactivityWarning, setInactivityWarning] = useState(false);

  const inactivityRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // ─── Reset inactivity timer ──────────────────────────────
  const [countdown, setCountdown] = useState(0);
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);

  const resetInactivity = useCallback(() => {
    setInactivityWarning(false);
    setCountdown(0);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);

    warningRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setInactivityWarning(true);
      let remaining = 60;
      setCountdown(remaining);
      countdownInterval.current = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          if (countdownInterval.current) clearInterval(countdownInterval.current);
          setCountdown(0);
        } else {
          setCountdown(remaining);
        }
      }, 1000);
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE);

    inactivityRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      if (countdownInterval.current) clearInterval(countdownInterval.current);
      const doSignOut = async () => {
        try {
          if (supabaseRef.current) await supabaseRef.current.auth.signOut();
        } catch (err) {
          console.error('[AuthProvider] Sign-out error during inactivity timeout:', err);
        }
        if (typeof window !== 'undefined') window.location.href = '/login';
      };
      doSignOut();
    }, INACTIVITY_TIMEOUT);
  }, []);

  // ─── Data-loaded callback (shared between initial load + onAuthStateChange) ──
  const markDataLoaded = useCallback(() => {
    if (!mountedRef.current) return;
    setIsDataLoaded(true);
    setIsLoading(false);
  }, []);

  const markProfileNotFound = useCallback(() => {
    if (!mountedRef.current) return;
    setProfileNotFound(true);
  }, []);

  // ─── Auth state listener ─────────────────────────────────
  useEffect(() => {
    supabaseRef.current = createClient();
    const supabase = supabaseRef.current;
    mountedRef.current = true;

    // Get initial session (Supabase SDK reads from sessionStorage automatically)
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mountedRef.current) return;
      if (s) {
        const u = buildUser(s);
        const vs = toVantageSession(s);
        setUser(u);
        setSession(vs);
        storeUser(u);
        storeSession(vs);
        setProfileNotFound(false);
        // ✅ isLoading stays true — DB sync callback will clear it
        syncUserProfile(u, setUser, () => mountedRef.current, markDataLoaded, markProfileNotFound, setError);
      } else {
        // No session — nothing to sync, we're done loading
        setProfileNotFound(false);
        setError(null);
        setIsDataLoaded(true);
        setIsLoading(false);
      }
    });

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setSession(null);
        clearUser();
        clearSession();
        setInactivityWarning(false);
        setIsDataLoaded(false);
        setProfileNotFound(false);
        setError(null);
        setIsLoading(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED' && s) {
        const vs = toVantageSession(s);
        setSession(vs);
        storeSession(vs);
        setInactivityWarning(false);
        return;
      }

      if (s && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) {
        const u = buildUser(s);
        const vs = toVantageSession(s);
        setUser(u);
        setSession(vs);
        storeUser(u);
        storeSession(vs);
        setProfileNotFound(false);
        // Lock UI until DB sync completes — prevent flash before profileNotFound check
        setIsLoading(true);
        setIsDataLoaded(false);
        // ✅ isLoading stays true — DB sync callback will clear it
        syncUserProfile(u, setUser, () => mountedRef.current, markDataLoaded, markProfileNotFound, setError);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [markDataLoaded]);

  // ─── Inactivity tracking (only when authenticated) ───────
  useEffect(() => {
    if (!session) {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      setInactivityWarning(false);
      return;
    }

    resetInactivity();

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetInactivity, { passive: true }));

    return () => {
      events.forEach(e => window.removeEventListener(e, resetInactivity));
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [session, resetInactivity]);

  // ─── Auth methods ────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = supabaseRef.current!;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(String(error.message || 'Authentication failed'));
    if (!data?.user || !data?.session) throw new Error('Sign in failed — server returned incomplete response.');
    // onAuthStateChange fires SIGNED_IN → syncUserProfile → markDataLoaded
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const supabase = supabaseRef.current!;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName || email.split('@')[0] } },
    });
    if (error) {
      const errMsg = String(error.message || '').toLowerCase();
      if (errMsg.includes('already registered') || errMsg.includes('already exists') ||
          errMsg.includes('already signed up') || error.status === 422) {
        throw new Error('An account with this email already exists. Please sign in instead.');
      }
      throw new Error(String(error.message || 'Authentication failed'));
    }
    // If no session returned, Supabase requires email confirmation — tell the UI
    if (!data.user || !data.session) return { needsConfirmation: true };
    // Session returned (email pre-confirmed or confirmation disabled).
    // DB record will be created by verify-user on next auth check — NOT here.
    // onAuthStateChange fires SIGNED_IN → syncUserProfile → verify-user
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current!;
    await supabase.auth.signOut();
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    const supabase = supabaseRef.current!;
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) {
        const errMsg = String(error.message || '');
        if (errMsg.includes('rate limit') || (error as any)?.status === 429)
          return { success: false, message: 'Please wait before requesting another email.' };
        if (errMsg.includes('already confirmed') || errMsg.includes('already verified'))
          return { success: false, message: 'Email is already verified. Please sign in.' };
        return { success: false, message: 'Unable to resend. Please try again later.' };
      }
      return { success: true, message: 'Verification email resent. Check your inbox!' };
    } catch {
      return { success: false, message: 'Unable to resend. Please try again later.' };
    }
  }, []);

  // ─── Context value ───────────────────────────────────────

  const value: AuthContextValue = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user && !!session,
    isDataLoaded,
    profileNotFound,
    error,
    inactivityWarning,
    inactivityCountdown: countdown,
    signIn,
    signUp,
    signOut,
    resendConfirmation,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

// ─── Hook ─────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
