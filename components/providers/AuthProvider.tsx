// ─── Auth Context Provider ────────────────────────────────────
// Supabase SDK manages session lifecycle (autoRefreshToken, persistSession).
// AuthProvider subscribes to onAuthStateChange for real-time updates.
// 10-minute inactivity timeout with 1-minute warning before logout.

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
  profileSynced: boolean;
  inactivityWarning: boolean;
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
  profileSynced: false,
  inactivityWarning: false,
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

/** Sync DB profile for a user — create if missing, merge if exists. */
async function syncUserProfile(u: User, token: string, setUser: (u: User) => void, mounted: () => boolean, setSynced: (v: boolean) => void) {
  try {
    const { getUserProfile, createUser } = await import('@/lib/supabase/user');
    const profile = await getUserProfile(u.id);
    if (!mounted()) { setSynced(true); return; }
    if (!profile) {
      // No DB row yet — create it
      await createUser({ email: u.email, displayName: u.displayName, token }).catch(() => {});
      setSynced(true);
      return;
    }
    // Merge DB values (source of truth for onboarding)
    const merged: User = {
      ...u,
      investorStyle: (profile.investorStyle || u.investorStyle) as InvestorStyle,
      investorStyleOnboarded: profile.investorStyleOnboarded ?? u.investorStyleOnboarded,
    };
    setUser(merged);
    storeUser(merged);
    // Sync localStorage
    if (merged.investorStyleOnboarded) localStorage.setItem('vantage:onboarded', 'true');
    if (merged.investorStyle) localStorage.setItem('vantage:investorStyle', merged.investorStyle);
    setSynced(true);
  } catch {
    setSynced(true);
    // DB sync is non-critical
  }
}

// ─── Provider Component ──────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<VantageSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  const [profileSynced, setProfileSynced] = useState(false);

  const inactivityRef = useRef<NodeJS.Timeout | null>(null);
  const warningRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  // Lazy init — createClient() throws if called during SSR

  // ─── Reset inactivity timer ──────────────────────────────
  const resetInactivity = useCallback(() => {
    setInactivityWarning(false);
    if (warningRef.current) clearTimeout(warningRef.current);
    if (inactivityRef.current) clearTimeout(inactivityRef.current);

    warningRef.current = setTimeout(() => {
      if (mountedRef.current) setInactivityWarning(true);
    }, INACTIVITY_TIMEOUT - WARNING_BEFORE);

    inactivityRef.current = setTimeout(async () => {
      if (mountedRef.current) {
        await supabaseRef.current?.auth.signOut();
      }
    }, INACTIVITY_TIMEOUT);
  }, []);

  // ─── Auth state listener ─────────────────────────────────
  useEffect(() => {
    // Lazy init — createClient() is browser-only
    supabaseRef.current = createClient();
    const supabase = supabaseRef.current;
    mountedRef.current = true;

    // Get initial session (Supabase SDK reads from localStorage automatically)
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mountedRef.current) return;
      if (s) {
        const u = buildUser(s);
        const vs = toVantageSession(s);
        setUser(u);
        setSession(vs);
        storeUser(u);
        storeSession(vs); // parallel copy for sync accessors
        syncUserProfile(u, s.access_token, setUser, () => mountedRef.current, setProfileSynced);
      } else {
        setProfileSynced(true);
      }
      setIsLoading(false);
    });

    // Subscribe to auth state changes (login, logout, token refresh, user update)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (!mountedRef.current) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setSession(null);
        clearUser();
        clearSession();
        setInactivityWarning(false);
        setProfileSynced(false);
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
        syncUserProfile(u, s.access_token, setUser, () => mountedRef.current, setProfileSynced);
      }
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
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

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
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
    if (error) {
      throw new Error(String(error.message || 'Authentication failed'));
    }
    if (!data?.user || !data?.session) {
      throw new Error('Sign in failed — server returned incomplete response.');
    }
    // onAuthStateChange will fire SIGNED_IN — no need to set state here
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
    if (!data.user || !data.session) {
      return { needsConfirmation: true };
    }
    // onAuthStateChange will fire SIGNED_IN
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseRef.current!;
    await supabase.auth.signOut();
    // onAuthStateChange will fire SIGNED_OUT
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
    profileSynced,
    inactivityWarning,
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
