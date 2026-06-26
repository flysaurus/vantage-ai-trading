// ─── Auth Context Provider (Supabase Auth) ───────────────────
// Uses Supabase Auth SDK natively — no custom argon2/password hashing.
// Session managed by Supabase SDK (sessionStorage for browser, cookies for SSR).
// All API calls send Supabase JWT as Bearer token → verified by requireAuth() Path A.

'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useCallback,
  useState,
  useRef,
} from 'react';
import { supabase } from '@/lib/supabase/client';
import { createAccount } from '@/app/actions/auth';
import type { User, InvestorStyle } from '@/types';

const INACTIVITY_TIMEOUT = 15 * 60 * 1000;
const WARNING_BEFORE = 2 * 60 * 1000;

// ─── Context Type ─────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isDataLoaded: boolean;
  profileNotFound: boolean;
  error: string | null;
  inactivityWarning: boolean;
  inactivityCountdown: number;
  resetActivity: () => void;
  showWelcomeBack: boolean;
  dismissWelcomeBack: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (data: { email: string; password: string; firstName: string; lastName: string; investorStyle: string; riskTolerance: string }) => Promise<{ needsConfirmation: boolean } | void>;
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

function buildUser(profile: any, local: ReturnType<typeof getLocalOnboarding>): User {
  const style = (profile?.investorStyle || local.style || 'buffett') as InvestorStyle;
  const risk = (profile?.riskTolerance || local.riskTolerance || 'Moderate') as User['riskTolerance'];
  return {
    id: profile?.id || '',
    email: profile?.email || '',
    displayName: profile?.firstName || profile?.email?.split('@')[0] || 'M',
    avatarUrl: profile?.avatarUrl,
    investorStyle: style,
    investorStyleSetAt: profile?.investorStyleSetAt,
    investorStyleOnboarded: profile?.investorStyleOnboarded === true,
    riskTolerance: risk,
    name: profile?.firstName || profile?.email?.split('@')[0] || 'M',
    createdAt: profile?.createdAt || '',
  };
}

// ─── Provider Component ──────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [showWelcomeBack, setShowWelcomeBack] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const inactivityRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

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

    inactivityRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      if (countdownInterval.current) clearInterval(countdownInterval.current);
      await supabase.auth.signOut();
      if (typeof window !== 'undefined') window.location.href = '/login';
    }, INACTIVITY_TIMEOUT);
  }, []);

  // ─── Initial session restore ─────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    const init = async () => {
      try {
        // Try restoring from Supabase session
        const { data: sessionData } = await supabase.auth.getSession();
        if (!mountedRef.current) return;

        if (!sessionData.session) {
          console.log('[AuthProvider] No Supabase session');
          setIsDataLoaded(true);
          setIsLoading(false);
          return;
        }

        // We have a session — fetch user profile
        const accessToken = sessionData.session.access_token;
        const userId = sessionData.session.user.id;

        // Store token for API calls
        if (accessToken) {
          sessionStorage.setItem('vantage-auth-token', accessToken);
        }

        // Fetch profile from our users table
        const profileRes = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!profileRes.ok) {
          // Profile lookup failed — still auth'd but no profile yet
          const local = getLocalOnboarding();
          const u: User = {
            id: userId,
            email: sessionData.session.user.email || '',
            displayName: sessionData.session.user.email?.split('@')[0] || 'M',
            investorStyle: local.style,
            riskTolerance: local.riskTolerance as User['riskTolerance'],
            investorStyleOnboarded: false,
            name: sessionData.session.user.email?.split('@')[0] || 'M',
            createdAt: '',
          };
          setUser(u);
          setIsDataLoaded(true);
          setIsLoading(false);
          return;
        }

        const profileData = await profileRes.json();
        const local = getLocalOnboarding();
        const u = buildUser(profileData.user, local);

        setUser(u);

        // Sync localStorage
        if (u.investorStyleOnboarded) {
          localStorage.setItem('vantage:onboarded', 'true');
        } else {
          localStorage.removeItem('vantage:onboarded');
        }
        if (u.investorStyle) localStorage.setItem('vantage:investorStyle', u.investorStyle);

        setError(null);
        setIsDataLoaded(true);
        setIsLoading(false);
      } catch (err: any) {
        console.error('[AuthProvider] Init failed:', err.message);
        if (mountedRef.current) {
          setIsDataLoaded(true);
          setIsLoading(false);
        }
      }
    };

    init();

    // Listen for auth state changes
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setError(null);
        setIsDataLoaded(false);
        sessionStorage.removeItem('vantage-auth-token');
        return;
      }

      if (event === 'SIGNED_IN' && session) {
        // Re-initialize with new session
        init();
      }
    });

    return () => {
      mountedRef.current = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  // ─── Inactivity tracking ────────────────────────────────

  useEffect(() => {
    if (!user) {
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
  }, [user, resetInactivity]);

  // ─── Auth methods ────────────────────────────────────────

  const signInFn = useCallback(async (email: string, password: string) => {
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      throw new Error(signInError.message.includes('Invalid login') 
        ? 'Invalid email or password.' 
        : signInError.message);
    }

    if (!data.session) {
      throw new Error('Unable to create session. Please try again.');
    }

    // Store token
    sessionStorage.setItem('vantage-auth-token', data.session.access_token);

    // Fetch profile
    const profileRes = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });

    const profile: any = profileRes.ok ? await profileRes.json() : {};
    const local = getLocalOnboarding();

    const u: User = {
      id: data.session.user.id,
      email: data.session.user.email || email,
      displayName: data.session.user.email?.split('@')[0] || 'M',
      investorStyle: (profile.user?.investorStyle || local.style || 'buffett') as InvestorStyle,
      riskTolerance: (profile.user?.riskTolerance || local.riskTolerance || 'Moderate') as User['riskTolerance'],
      investorStyleOnboarded: profile.user?.investorStyleOnboarded ?? false,
      investorStyleSetAt: profile.user?.investorStyleSetAt,
      name: data.session.user.email?.split('@')[0] || 'M',
      createdAt: profile.user?.createdAt || '',
    };

    setUser(u);

    if (u.investorStyleOnboarded) {
      localStorage.setItem('vantage:onboarded', 'true');
    } else {
      localStorage.removeItem('vantage:onboarded');
    }
    if (u.investorStyle) localStorage.setItem('vantage:investorStyle', u.investorStyle);

    setError(null);
    setIsDataLoaded(true);
    setIsLoading(false);
  }, []);

  const signUpFn = useCallback(async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    investorStyle: string;
    riskTolerance: string;
  }) => {
    // Call the server action — handles auth signup + users table insert + demo seed
    const result = await createAccount(data);

    if (!result.success) {
      throw new Error(result.error || 'Account creation failed.');
    }

    return { needsConfirmation: result.needsVerification ?? false };
  }, []);

  const signOutFn = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setError(null);
    setInactivityWarning(false);
    setShowWelcomeBack(false);
    setIsDataLoaded(false);
    sessionStorage.removeItem('vantage-auth-token');
  }, []);

  const resendConfirmation = useCallback(async (email: string) => {
    try {
      const { error: resendErr } = await supabase.auth.resend({ 
        type: 'signup', 
        email 
      });
      if (resendErr) {
        return { success: false, message: resendErr.message };
      }
      return { success: true, message: 'Verification email resent. Check your inbox!' };
    } catch {
      return { success: false, message: 'Unable to resend. Please try again later.' };
    }
  }, []);

  const dismissWelcomeBack = useCallback(() => setShowWelcomeBack(false), []);

  const value: AuthContextValue = {
    user,
    session: null,
    isLoading,
    isAuthenticated: !!user,
    isDataLoaded,
    profileNotFound: false,
    error,
    inactivityWarning,
    inactivityCountdown: countdown,
    resetActivity: resetInactivity,
    showWelcomeBack,
    dismissWelcomeBack,
    signIn: signInFn,
    signUp: signUpFn,
    signOut: signOutFn,
    resendConfirmation,
  };

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
