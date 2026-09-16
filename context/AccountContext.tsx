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
import { useOrderStore, usePortfolioStore } from '@/store';

const STORAGE_KEY = 'vantage:activeAccount';

interface AccountContextValue {
  accounts: AccountEntry[];
  activeAccountId: string;
  activeAccount: AccountEntry | null;
  setActiveAccount: (accountId: string) => void;
  isLoading: boolean;
  /**
   * True once the active account is genuinely RESOLVED against the server's
   * account list. Data consumers MUST NOT fetch while this is false: the
   * selection is still the localStorage value or the 'demo' placeholder, so an
   * unscoped account/orders read would be refused by the server's ambiguity
   * guard (409) and the 'demo' placeholder would render a DIFFERENT account's
   * numbers (the phantom $100k idle-cash Noticed card on a live broker screen).
   */
  isAccountResolved: boolean;
  /**
   * Set when the account list could not be loaded (stalled request, network
   * failure, non-OK response). The list stays empty, so the app falls back to
   * its legacy path — but the splash must offer a retry instead of spinning
   * forever (the blank-splash failure).
   */
  accountsError: string | null;
  /** Re-runs the account fetch (shown as "Try again" on the splash). */
  retryAccounts: () => void;
}

const AccountContext = createContext<AccountContextValue>({
  accounts: [],
  activeAccountId: 'demo',
  activeAccount: null,
  setActiveAccount: () => {},
  isLoading: true,
  accountsError: null,
  retryAccounts: () => {},
  // Outside the provider there is no list to resolve against, so never gate.
  isAccountResolved: true,
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
  const [accountsError, setAccountsError] = useState<string | null>(null);

  // Fetch accounts on mount.
  //
  // A STALLED request used to leave `isLoading` true forever: the splash renders
  // a full-screen "Loading accounts…" spinner while `isLoading`, so the app was
  // simply blank with no error, no timeout and no retry — the reported
  // blank-splash flakiness. The request is now bounded; on timeout (or failure)
  // we settle the loading flag, surface an explicit error and let the splash
  // offer a retry. The server's ambiguity refusal is untouched.
  const ACCOUNTS_FETCH_TIMEOUT_MS = 10000;
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), ACCOUNTS_FETCH_TIMEOUT_MS);

    async function fetchAccounts() {
      try {
        const res = await apiGet('/api/accounts', { signal: controller.signal });
        if (cancelled) return;
        if (res.status === 401) return; // session not ready — auth layer owns this
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setAccounts(data.accounts || []);
            setAccountsError(null);
          }
          return;
        }
        if (!cancelled) setAccountsError(`Account list unavailable (HTTP ${res.status}).`);
      } catch (err) {
        if (cancelled) return;
        const aborted = controller.signal.aborted;
        console.error('[AccountContext] Failed to fetch accounts:', aborted ? 'timed out' : err);
        setAccountsError(
          aborted
            ? 'Loading your accounts is taking longer than usual.'
            : 'Could not load your accounts.',
        );
      } finally {
        clearTimeout(timer);
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchAccounts();
    return () => { cancelled = true; clearTimeout(timer); controller.abort('unmount'); };
  }, [attempt]);

  const retryAccounts = useCallback(() => {
    setIsLoading(true);
    setAccountsError(null);
    setAttempt((n) => n + 1);
  }, []);

  const setActiveAccount = useCallback((accountId: string) => {
    if (accountId === activeAccountId) return; // no-op — same account

    // Persist the new selection, then update state IN PLACE (no full page reload).
    // A reload is jarring and is an anti-pattern — the investor-style switcher
    // already updates in place. PortfolioContext + useOrders re-key off
    // activeAccountId and re-fetch automatically; we clear the order store here
    // so stale orders from the previous account don't linger during the refetch.
    //
    // PART 2 (stale cross-account balance): also INVALIDATE the resolved
    // portfolio. The store holds the previous account's real equity/cash/positions
    // with `loading === false`, so without this the old account's balance keeps
    // rendering under the new account's name until the new fetch resolves.
    // Clearing SYNCHRONOUSLY at click time (before any effect/async work) closes
    // the window completely — the UI drops to its loading state on this tick.
    saveActiveAccount(accountId);
    setActiveAccountId(accountId);

    try {
      useOrderStore.getState().setOrders([]);
    } catch { /* store not initialized in all contexts */ }

    try {
      usePortfolioStore.getState().clearAccount();
      usePortfolioStore.getState().setLoading(true);
    } catch { /* store not initialized in all contexts */ }
  }, [activeAccountId]);

  // ── Resolve a VISIBLE account when the current selection isn't in the list ──
  // When accounts load and the current selection is the unset default, or
  // points at an account that no longer exists, prefer a connected live/paper
  // broker account so the Portfolio and AI Advisor reflect the user's real
  // holdings (demo only as a last resort).
  //
  // ⚠️ This is a DISPLAY fallback, not a selection: it must never write to
  // localStorage. It used to call `setActiveAccount()` (which persists), so
  // merely loading a screen that mounts the provider — e.g. backing out of
  // Broker Connections, which re-mounts the shell at '/?' — silently promoted
  // an unrelated account (the first non-demo one, e.g. Fidelity) to "active".
  // The user's stored choice is only ever written by an explicit action
  // (picker selection, connect flow, account switcher) via setActiveAccount().
  useEffect(() => {
    if (isLoading || accounts.length === 0) return;

    const storedChoice =
      typeof window === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    const selectionResolves = accounts.some((a) => a.id === activeAccountId);

    // An explicit choice that still resolves is never touched.
    if (storedChoice !== null && selectionResolves) return;
    // Nothing was ever chosen and the selection already points at a real
    // account (not the 'demo' placeholder) — leave it alone.
    if (storedChoice === null && selectionResolves && activeAccountId !== 'demo') return;

    const preferred =
      accounts.find((a) => !a.isDemo) || accounts.find((a) => a.isDemo);
    if (preferred && preferred.id !== activeAccountId) {
      // DISPLAY fallback only — intentionally NOT persisted (see above).
      setActiveAccountId(preferred.id);
    }
  }, [accounts, isLoading, activeAccountId]);

  // ── Is the active account actually RESOLVED yet? ─────────────────────────
  // `activeAccountId` boots as the stored value, or the 'demo' placeholder when
  // nothing was ever chosen — while `/api/accounts` is still in flight. Until a
  // selection genuinely resolves against that list, data consumers must not
  // fetch (see the interface docs above). A choice that was explicitly STORED
  // counts as resolved even if it is 'demo' (a real demo user), and a settled
  // fetch that returned no accounts at all falls through to legacy behaviour
  // (nothing to gate on; that path has its own error/retry handling).
  const storedChoiceValue =
    typeof window === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  const selectionResolves = accounts.some((a) => a.id === activeAccountId);
  const hasNonDemoAccount = accounts.some((a) => !a.isDemo);
  const isAccountResolved =
    !isLoading &&
    (accounts.length === 0 ||
      (selectionResolves &&
        (activeAccountId !== 'demo' || !hasNonDemoAccount || storedChoiceValue !== null)));

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
        isAccountResolved,
        accountsError,
        retryAccounts,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccounts(): AccountContextValue {
  return useContext(AccountContext);
}
