// ─── Auth Context Provider ────────────────────────────────────
// Provides auth state to the entire app via React context.
// Handles session detection, loading state, and token refresh.

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
import { getSession, storeSession, clearSession, getUser, storeUser, clearUser, signIn as authSignIn, signUp as authSignUp, signOut as authSignOut, refreshSession } from '@/lib/auth';

// ─── Context Type ─────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: VantageSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ needsConfirmation: boolean } | void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  session: null,
  isLoading: true,
  isAuthenticated: false,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
});

// ─── Provider Component ──────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<VantageSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Session Detection on Mount ────────────────────────────

  useEffect(() => {
    let mounted = true;
    const safetyTimeout = setTimeout(() => {
      if (mounted) setIsLoading(false);
    }, 5000); // Safety: never spin longer than 5 seconds

    const stored = getSession();

    if (!stored) {
      clearTimeout(safetyTimeout);
      setIsLoading(false);
      return;
    }

    // Load user from sessionStorage immediately (no API call needed)
    const storedUser = getUser();
    if (storedUser) {
      setUser(storedUser);
      setSession(stored);
      clearTimeout(safetyTimeout);
      setIsLoading(false);
      return;
    }

    // No stored user — validate session token with Supabase
    // (this should only happen for sessions created before we added user storage)
    setSession(stored);

    import('@/lib/supabase')
      .then(({ createClient }) => {
        const supabase = createClient();
        return supabase.auth.getUser(stored.token);
      })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error || !data.user) {
          clearSession();
          clearUser();
          setSession(null);
        } else {
          const u: User = {
            id: data.user.id,
            email: data.user.email || '',
            displayName:
              data.user.user_metadata?.display_name ||
              data.user.email?.split('@')[0] ||
              'Trader',
            avatarUrl: data.user.user_metadata?.avatar_url,
            investorStyle: (data.user.user_metadata?.investor_style as InvestorStyle) || 'buffett',
            investorStyleSetAt: null,
            investorStyleOnboarded: false,
            createdAt: data.user.created_at,
          };
          setUser(u);
          storeUser(u); // Cache for next visit
        }
      })
      .catch(() => {
        if (!mounted) return;
        clearSession();
        clearUser();
        setSession(null);
      })
      .finally(() => {
        if (!mounted) return;
        clearTimeout(safetyTimeout);
        setIsLoading(false);
      });

    return () => {
      mounted = false;
      clearTimeout(safetyTimeout);
    };
  }, []);

  // ─── Token Refresh ─────────────────────────────────────────

  useEffect(() => {
    if (!session) return;

    // Refresh token 5 minutes before expiry
    const expiresInMs = (session.expiresAt - Math.floor(Date.now() / 1000)) * 1000;
    const refreshIn = Math.max(expiresInMs - 5 * 60 * 1000, 60_000);

    refreshTimerRef.current = setTimeout(async () => {
      const refreshed = await refreshSession();
      if (refreshed) {
        setSession(refreshed);
      } else {
        setSession(null);
        setUser(null);
      }
    }, refreshIn);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [session]);

  // ─── Auth Methods ──────────────────────────────────────────

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authSignIn(email, password);
    setUser(result.user);
    setSession(result.session);
    storeUser(result.user);
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const result = await authSignUp(email, password, displayName);
      if (result.needsConfirmation) {
        return { needsConfirmation: true };
      }
      setUser(result.user);
      setSession(result.session);
      storeUser(result.user);
    },
    []
  );

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setSession(null);
    clearUser();
  }, []);

  // ─── Context Value ─────────────────────────────────────────

  const value: AuthContextValue = {
    user,
    session,
    isLoading,
    isAuthenticated: !!user && !!session,
    signIn,
    signUp,
    signOut,
  };

  return React.createElement(
    AuthContext.Provider,
    { value },
    children
  );
}

// ─── Hook ─────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
