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
import type { User, VantageSession } from '@/types';
import { getSession, storeSession, clearSession, signIn as authSignIn, signUp as authSignUp, signOut as authSignOut, refreshSession } from '@/lib/auth';

// ─── Context Type ─────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  session: VantageSession | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
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
    const stored = getSession();

    if (stored) {
      setSession(stored);

      // Fetch current user data
      import('@/lib/supabase')
        .then(({ createClient }) => {
          const supabase = createClient();
          return supabase.auth.getUser(stored.token);
        })
        .then(({ data, error }) => {
          if (error || !data.user) {
            clearSession();
            setSession(null);
          } else {
            setUser({
              id: data.user.id,
              email: data.user.email || '',
              displayName:
                data.user.user_metadata?.display_name ||
                data.user.email?.split('@')[0] ||
                'Trader',
              avatarUrl: data.user.user_metadata?.avatar_url,
              createdAt: data.user.created_at,
            });
          }
        })
        .catch(() => {
          clearSession();
          setSession(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      setIsLoading(false);
    }
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
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const result = await authSignUp(email, password, displayName);
      setUser(result.user);
      setSession(result.session);
    },
    []
  );

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setSession(null);
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
