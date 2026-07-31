// ─── Account Context ──────────────────────────────────────────
// Provides the unified account list + active account selection
// for the persistent AccountSwitcher.
//
// Active account drives what Portfolio tab displays.
// Trades always route to Demo regardless of active account (Phase 2b).

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { AccountEntry } from '@/app/api/accounts/route';
import { apiGet } from '@/lib/api-client';

const STORAGE_KEY = 'vantage:activeAccount';

interface AccountContextValue {
  accounts: AccountEntry[];
  activeAccountId: string;
  activeAccount: AccountEntry | null;
  setActiveAccount: (accountId: string) => void;
  isLoading: boolean;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  activeAccountId: 'demo',
  activeAccount: null,
  setActiveAccount: () => {},
  isLoading: true,
});

function loadActiveAccount(): string {
  if (typeof window === 'undefined') return 'demo';
  try {
    return localStorage.getItem(STORAGE_KEY) || 'demo';
  } catch {
    return 'demo';
  }
}

function saveActiveAccount(accountId: string) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, accountId);
  } catch { /* ignore quota */ }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<AccountEntry[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>(loadActiveAccount);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch accounts on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchAccounts() {
      try {
        const res = await apiGet('/api/accounts');
        if (res.status === 401) return;
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAccounts(data.accounts || []);
          }
        }
      } catch (err) {
        console.error('[AccountContext] Failed to fetch accounts:', err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAccounts();
    return () => { cancelled = true; };
  }, []);

  const setActiveAccount = useCallback((accountId: string) => {
    setActiveAccountId(accountId);
    saveActiveAccount(accountId);
  }, []);

  const activeAccount = useMemo(
    () => accounts.find(a => a.id === activeAccountId) || null,
    [accounts, activeAccountId]
  );

  return (
    <AccountContext.Provider
      value={{
        accounts,
        activeAccountId,
        activeAccount,
        setActiveAccount,
        isLoading,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts(): AccountContextValue {
  return useContext(AccountContext);
}
