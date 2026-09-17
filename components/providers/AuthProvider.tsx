'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { invalidateGetCache } from '@/lib/http/get-cache';

interface AuthContextValue {
  user: Record<string, unknown> | null;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = async (opts?: { force?: boolean }) => {
    try {
      // Shares the client-side GET cache with the route gate (`lib/app-state.ts`)
      // and the greeting modal, so the profile is fetched once per window
      // instead of three times. `refreshUser()` is an explicit refresh after a
      // profile change, so it bypasses the cache.
      if (opts?.force) invalidateGetCache('/api/auth/me');
      const res = await apiGet('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data?.user ?? null);
      }
    } catch {
      // keep current user on error
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = async () => {
    await fetchUser({ force: true });
  };

  useEffect(() => {
    fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRITICAL: Always render children.
  // Never gate rendering on isLoading.
  // useAppState handles routing separately.
  return (
    <AuthContext.Provider value={{ user, isLoading, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
