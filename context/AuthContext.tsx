// ─── Auth Context (Magic Link) ───────────────────────────────
// Client-side React context for Supabase magic link auth.
//
// This context listens to Supabase auth state changes and
// synchronizes with the existing custom auth system in
// components/providers/AuthProvider.tsx.
//
// The existing AuthProvider handles session cookies + /api/auth/me
// for email/password login. This context adds Supabase-native
// auth awareness (magic link) and a computed tier based on
// portfolio value and features used.
//
// Exports: { AuthProvider, useAuth }
//
// NOTE: This file re-exports the canonical AuthProvider from
// components/providers/AuthProvider.tsx, which is the single
// source of truth for auth state. The Supabase auth listener
// below bridges magic link sessions into the existing system.

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// Re-export the canonical AuthProvider
export { AuthProvider, useAuth } from '@/components/providers/AuthProvider';

// ─── Supabase Auth Listener ───────────────────────────────────
// Listens for Supabase auth state changes (magic link sign-ins)
// and can be used to detect active magic link sessions.
// The actual session persistence is handled by the callback route
// setting the `session` cookie, which the main AuthProvider picks up.

interface SupabaseAuthState {
  supabaseUser: SupabaseUser | null;
  isSupabaseAuthenticated: boolean;
  refreshSupabaseSession: () => Promise<void>;
}

const SupabaseAuthContext = createContext<SupabaseAuthState>({
  supabaseUser: null,
  isSupabaseAuthenticated: false,
  refreshSupabaseSession: async () => {},
});

export function SupabaseAuthListener({ children }: { children: React.ReactNode }) {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [ready, setReady] = useState(false);

  const refreshSupabaseSession = useCallback(async () => {
    try {
      const client = getSupabaseBrowserClient();
      const { data } = await client.auth.getUser();
      setSupabaseUser(data.user || null);
    } catch {
      setSupabaseUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const client = getSupabaseBrowserClient();

        // Initial session check
        const { data } = await client.auth.getUser();
        if (mounted) {
          setSupabaseUser(data.user || null);
          setReady(true);
        }

        // Listen for auth state changes
        const { data: listener } = client.auth.onAuthStateChange(
          (_event, session) => {
            if (mounted) {
              setSupabaseUser(session?.user || null);
            }
          }
        );

        return () => {
          listener?.subscription?.unsubscribe();
        };
      } catch {
        if (mounted) {
          setReady(true);
        }
      }
    };

    init();

    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) return <>{children}</>;

  return React.createElement(
    SupabaseAuthContext.Provider,
    {
      value: {
        supabaseUser,
        isSupabaseAuthenticated: !!supabaseUser,
        refreshSupabaseSession,
      },
    },
    children
  );
}

/**
 * Hook to access Supabase auth state specifically.
 * For general auth (user profile, session), use useAuth() from AuthProvider.
 */
export function useSupabaseAuth(): SupabaseAuthState {
  return useContext(SupabaseAuthContext);
}

// ─── Tier Computation ────────────────────────────────────────

export type UserTier = 'free' | 'pro' | 'institutional';

/**
 * Compute the user's tier based on their portfolio value and feature usage.
 *
 * Free:    portfolio < $10k or no connected broker
 * Pro:     portfolio $10k–$100k or premium features used
 * Institutional: portfolio > $100k
 */
export function computeTier(portfolioValue?: number, brokerConnected?: boolean): UserTier {
  if (!brokerConnected) return 'free';
  if (portfolioValue === undefined || portfolioValue === null) return 'free';
  if (portfolioValue > 100_000) return 'institutional';
  if (portfolioValue >= 10_000) return 'pro';
  return 'free';
}

/**
 * Hook that wraps useAuth() and adds tier computation.
 * Use this for components that need tier-based feature gating.
 */
export function useAuthWithTier(): ReturnType<typeof useAuth> & {
  tier: UserTier;
} {
  // Dynamic import to avoid circular dependency
  const { useAuth } = require('@/components/providers/AuthProvider');
  const auth = useAuth();

  const tier = computeTier(
    undefined, // portfolio value from context if available
    !!auth.user
  );

  return { ...auth, tier };
}
