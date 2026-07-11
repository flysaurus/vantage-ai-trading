'use client';

import { createContext, useContext, useEffect, useState } from 'react';

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

  const fetchUser = async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
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

  useEffect(() => {
    fetchUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // CRITICAL: Always render children.
  // Never gate rendering on isLoading.
  // useAppState handles routing separately.
  return (
    <AuthContext.Provider value={{ user, isLoading, refreshUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
