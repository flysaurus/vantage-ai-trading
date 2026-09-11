'use client';

// ─── useDisplayAccount ──────────────────────────────────────
// THE single source of the "which account's numbers am I allowed to show"
// decision (PART 2 scope gate). Extracted from PortfolioTab so the
// full-screen Position Detail overlay (which mounts ABOVE the tab tree and can
// be opened from Insights) resolves the exact same account + read-only state.
//
// Rules (unchanged from PortfolioTab):
//   • Demo must NEVER show broker data — scope the data source by account.
//   • Only accept a resolved account whose `accountScope` matches the selected
//     account id. An id mismatch = still holding the previous account's numbers
//     → treat as unresolved (null), never display them.
import { usePortfolio } from '@/hooks/usePortfolio';
import { useLivePortfolio } from '@/context/PortfolioContext';
import { useAccounts } from '@/context/AccountContext';
import { useBroker } from '@/components/providers/BrokerProvider';
import type { AccountSummary, Position } from '@/types';

export function useDisplayAccount() {
  const {
    account: brokerAccount,
    accountScope: brokerScope,
    loading: brokerLoading,
    error: brokerError,
    refresh: brokerRefresh,
  } = usePortfolio();
  const {
    account: liveAccount,
    accountScope: liveScope,
    loading: liveLoading,
    refresh: liveRefresh,
  } = useLivePortfolio();
  const { activeAccount, activeAccountId } = useAccounts();
  const { isConnected } = useBroker();

  const isShowingDemo = activeAccount?.isDemo ?? false;
  // Read-only = live broker connection without trading access (demo is always full).
  const isReadOnly = !isShowingDemo && !(activeAccount?.tradingEnabled ?? false);
  const isBrokerExpected = isConnected && !isShowingDemo;

  const displayAccount: AccountSummary | null = isBrokerExpected
    ? brokerScope === (activeAccountId ?? null)
      ? (brokerAccount as AccountSummary | null)
      : null
    : liveScope === (activeAccountId ?? null)
      ? (liveAccount as AccountSummary | null)
      : null;

  const loading = isBrokerExpected ? brokerLoading : liveLoading;
  const positions: Position[] = displayAccount?.positions || [];

  return {
    displayAccount,
    positions,
    loading,
    brokerError,
    isShowingDemo,
    isReadOnly,
    isBrokerExpected,
    isConnected,
    activeAccount,
    activeAccountId,
    brokerRefresh,
    liveRefresh,
  };
}

export default useDisplayAccount;
