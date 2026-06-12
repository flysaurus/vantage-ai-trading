// ─── Auth Context Provider ────────────────────────────────────
// Custom auth system — replaces Supabase Auth SDK entirely.
// Session: HTTP-only cookie (set by /api/auth/login) + /api/auth/me for validation.
// Frontend state: sessionStorage + in-memory React context.
// 15-minute inactivity timeout with 2-minute warning before logout.
//
// LOADING GUARANTEE:
//   isLoading stays true until /api/auth/me confirms the session and
//   the DB user profile is confirmed (investorStyleOnboarded etc).
//   Pages gate on isDataLoaded to prevent flash / race conditions.

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

const INACTIVITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const WARNING_BEFORE = 2 * 60 * 1000;       // warn 2 minutes before logout

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
  /** Manually trigger an activity reset (e.g. after API call) */
  resetActivity: () => void;
  /** Show welcome-back toast on fresh login */
  showWelcomeBack: boolean;
  dismissWelcomeBack: () => void;
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
  resetActivity: () => {},
  showWelcomeBack: false,
  dismissWelcomeBack: () => {},
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  resendConfirmation: async () => ({ success: false, message: '' }),
});

// ─── Helpers ──────────────────────────────────────────────────

function getLocalOnboarding(): { onboarded: boolean; style: InvestorStyle; riskTolerance: string } {
  if (typeof window === 'undefined') return { onboarded: false, style: 'buffett', riskTolerance: 'Moderate' };
  try {
    const style = (localStorage.getItem('vantage:investorStyle') as InvestorStyle) || 'buffett';
    const styleRiskMap: Record<string, string> = {
      growth: 'Aggressive', buffett: 'Moderate', lynch: 'Moderate',
      livermore: 'Aggressive', soros: 'Aggressive', dividend: 'Conservative',
    };
    const riskTolerance = localStorage.getItem('vantage:riskTolerance') || styleRiskMap[style] || 'Moderate';
    return {
      onboarded: localStorage.getItem('vantage:onboarded') === 'true',
      style,
      riskTolerance,
    };
  } catch {
    return { onboarded: false, style: 'buffett', riskTolerance: 'Moderate' };
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
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);

  const inactivityRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const [countdown, setCountdown] = useState(0);
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);

  // ─── Reset inactivity timer ──────────────────────────────

  const resetInactivity = useCallback(() => {
    setInactivityWarning(false);
    setCountdown(0);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);
    if (countdownInterval.current) clearInterval(countdownInterval.current);

    warningRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      setInactivityWarning(true);
      const warningTotal = Math.ceil(WARNING_BEFORE / 1000);
      let remaining = warningTotal;
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
      // Redirect to login — cookie cleared server-side on next API call
      clearUser();
      clearSession();
      if (typeof window !== 'undefined') window.location.href = '/login';
    }, INACTIVITY_TIMEOUT);
  }, []);

  // ─── Initial session check via /api/auth/me ──────────────

  useEffect(() => {
    mountedRef.current = true;
    console.log('[AuthProvider] 🔍 Checking session via /api/auth/me...');

    fetch('/api/auth/me')
      .then(async (res) => {
        if (!mountedRef.current) return;

        if (!res.ok) {
          console.log('[AuthProvider] No valid session');
          setIsDataLoaded(true);
          setIsLoading(false);
          return;
        }

        const data = await res.json();
        if (!data?.user) {
          console.log('[AuthProvider] No user in /me response');
          setIsDataLoaded(true);
          setIsLoading(false);
          return;
        }

        console.log('[AuthProvider] ✅ Session valid — user:', data.user.email);

        const local = getLocalOnboarding();
        const cached = getUser();

        const style = (data.user.investorStyle || cached?.investorStyle || local.style || 'buffett') as InvestorStyle;
        const riskDerived = local.riskTolerance || 'Moderate';

        const u: User = {
          id: data.user.id,
          email: data.user.email,
          displayName: data.user.displayName || data.user.email.split('@')[0],
          avatarUrl: data.user.avatarUrl,
          investorStyle: style,
          investorStyleSetAt: data.user.investorStyleSetAt || undefined,
          investorStyleOnboarded: data.user.investorStyleOnboarded === true,
          riskTolerance: (data.user.riskTolerance || riskDerived) as User['riskTolerance'],
          name: data.user.displayName || data.user.email?.split('@')[0] || 'M',
          createdAt: data.user.createdAt || '',
        };

        // Sync localStorage with authoritative API state.
        // If API says NOT onboarded, clear any stale flag from prior sessions.
        if (u.investorStyleOnboarded) {
          localStorage.setItem('vantage:onboarded', 'true');
        } else {
          localStorage.removeItem('vantage:onboarded');
        }
        if (u.investorStyle) localStorage.setItem('vantage:investorStyle', u.investorStyle);

        const vs: VantageSession = {
          token: '', // HTTP-only cookie — token not exposed to JS
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
          userId: data.user.id,
        };

        setUser(u);
        setSession(vs);
        storeUser(u);
        storeSession(vs);
        setProfileNotFound(false);
        setError(null);

        if (u.investorStyleOnboarded) localStorage.setItem('vantage:onboarded', 'true');
        if (u.investorStyle) localStorage.setItem('vantage:investorStyle', u.investorStyle);

        setIsDataLoaded(true);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('[AuthProvider] Session check failed:', err.message);
        if (mountedRef.current) {
          setIsDataLoaded(true);
          setIsLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ─── Inactivity tracking (only when authenticated) ───────

  useEffect(() => {
    if (!session) {
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
      setInactivityWarning(false);
      return;
    }

    resetInactivity();

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'mousemove'];
    window.addEventListener('focus', resetInactivity);
    events.forEach(e => window.addEventListener(e, resetInactivity, { passive: true }));

    return () => {
      window.removeEventListener('focus', resetInactivity);
      events.forEach(e => window.removeEventListener(e, resetInactivity));
      if (inactivityRef.current) clearTimeout(inactivityRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [session, resetInactivity]);

  // ─── Auth methods ────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string) => {
    let res: Response;
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch (err: any) {
      throw new Error(err.message || 'Network error. Please try again.');
    }

    const data = await res.json();

    if (res.status === 202 && data.requires2FA) {
      // 2FA is needed — caller handles the 2FA flow (login page)
      const error: any = new Error('2FA verification required');
      error.requires2FA = true;
      error.userId = data.userId;
      throw error;
    }

    if (!res.ok) {
      throw new Error(data.error || 'Invalid email or password');
    }

    // Fetch user profile via /me to populate context
    const meRes = await fetch('/api/auth/me');
    const meData = await meRes.json();

    if (!meRes.ok || !meData?.user) {
      throw new Error('Login succeeded but session could not be established. Please try again.');
    }

    const local = getLocalOnboarding();
    const cached = getUser();

    const style = (meData.user.investorStyle || cached?.investorStyle || local.style || 'buffett') as InvestorStyle;
    const riskDerived = local.riskTolerance || 'Moderate';

    const u: User = {
      id: meData.user.id,
      email: meData.user.email,
      displayName: meData.user.displayName || meData.user.email.split('@')[0],
      avatarUrl: meData.user.avatarUrl,
      investorStyle: style,
      investorStyleSetAt: meData.user.investorStyleSetAt || undefined,
      investorStyleOnboarded: meData.user.investorStyleOnboarded === true,
      riskTolerance: (meData.user.riskTolerance || riskDerived) as User['riskTolerance'],
      name: meData.user.displayName || meData.user.email?.split('@')[0] || 'M',
      createdAt: meData.user.createdAt || '',
    };

    const vs: VantageSession = {
      token: '',
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      userId: meData.user.id,
    };

    setUser(u);
    setSession(vs);
    storeUser(u);
    storeSession(vs);
    setProfileNotFound(false);
    setError(null);

    if (u.investorStyleOnboarded) {
      localStorage.setItem('vantage:onboarded', 'true');
    } else {
      localStorage.removeItem('vantage:onboarded');
    }
    if (u.investorStyle) localStorage.setItem('vantage:investorStyle', u.investorStyle);

    setIsDataLoaded(true);
    setIsLoading(false);
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName: displayName?.trim() }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Signup failed');
    }

    // Custom auth always requires email verification — no session is returned
    return { needsConfirmation: true };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear locally even if server call fails
    }
    setUser(null);
    setSession(null);
    clearUser();
    clearSession();
    setInactivityWarning(false);
    setShowWelcomeBack(false);
    setIsDataLoaded(false);
    setProfileNotFound(false);
    setError(null);
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resend: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error || 'Unable to resend' };
      }
      return { success: true, message: 'Verification email resent. Check your inbox!' };
    } catch {
      return { success: false, message: 'Unable to resend. Please try again later.' };
    }
  }, []);

  // ─── Context value ───────────────────────────────────────

  const dismissWelcomeBack = useCallback(() => setShowWelcomeBack(false), []);

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
    resetActivity: resetInactivity,
    showWelcomeBack,
    dismissWelcomeBack,
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
