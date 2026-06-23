// ─── Auth Context (Minimal Supabase) ─────────────────────────
// Minimal Supabase auth context used by the page router.
// getSession() called immediately on mount to fix session
// hydration after magic link redirect.
// onAuthStateChange as backup for live updates.
// No profile fetching — that stays in the full AuthProvider.

'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  tier: 'demo' | 'silver' | 'gold';
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  tier: 'demo',
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = getSupabaseBrowserClient();

  useEffect(() => {
    let resolved = false;

    // Safety timeout: if nothing resolves within 5s, bail out
    const safetyTimer = setTimeout(() => {
      if (!resolved) {
        console.warn('[AuthContext] Session check timed out — proceeding as unauthenticated');
        setLoading(false);
        resolved = true;
      }
    }, 5000);

    // Get initial session immediately
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!resolved) {
          setSession(data.session);
          setUser(data.session?.user ?? null);
          setLoading(false);
          resolved = true;
        }
      })
      .catch((err) => {
        console.error('[AuthContext] getSession failed:', err.message);
        if (!resolved) {
          setLoading(false);
          resolved = true;
        }
      });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!resolved) {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
        resolved = true;
      }
    });

    return () => {
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        tier: 'demo',
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
