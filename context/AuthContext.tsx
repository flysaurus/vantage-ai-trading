// ─── Auth Context (Minimal) ─────────────────────────────────
// Thin wrapper around useAppState — makes auth state available
// via hook to any component without prop-drilling.
// useAppState is the single source of truth.

'use client';
import { createContext, useContext } from 'react';
import { useAppState, type AppStateResult } from '@/lib/app-state';

const AuthContext = createContext<AppStateResult>({
  state: 'loading',
  user: null,
  profile: null,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const appState = useAppState();

  return (
    <AuthContext.Provider value={appState}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
