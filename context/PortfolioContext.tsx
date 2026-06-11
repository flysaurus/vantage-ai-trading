'use client';

/**
 * PortfolioContext — single source of truth for portfolio data.
 *
 * Fetches live Finnhub quotes for all position symbols, computes
 * AccountSummary from real prices, and provides it to all tabs.
 * Both AI tab and Portfolio tab read from this same context.
 *
 * No hardcoded values. Everything derived from live prices.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoAccount, getDemoSymbols, getDemoSectorAllocations } from '@/lib/demo-data';
import type { AccountSummary, Position, SectorAllocation } from '@/types';

// ─── Types ─────────────────────────────────────────────────

interface PortfolioContextValue {
  /** Live-priced account summary (demo mode) or broker account */
  account: AccountSummary | null;
  /** Whether quotes are still loading */
  loading: boolean;
  /** Error message if quote fetch failed */
  error: string | null;
  /** Force refresh quotes */
  refresh: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  account: null,
  loading: true,
  error: null,
  refresh: () => {},
});

// ─── Provider ──────────────────────────────────────────────

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { isConnected } = useBroker();
  const { user } = useAuth();

  // Seed with demo data immediately — cards render on load, prices update async
  const [account, setAccount] = useState<AccountSummary | null>(() => {
    if (isConnected) return null;
    const style = (user?.investorStyle || 'buffett') as any;
    // Build seed account with avgCost as fallback prices (no live quotes yet)
    return getDemoAccount(style, {});
  });
  const [loading, setLoading] = useState(false); // seed data available immediately
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (isConnected) return;

    try {
      setError(null);

      const style = (user?.investorStyle || 'buffett') as any;
      const symbols = getDemoSymbols(style as any);

      console.log('[Portfolio] Fetching quotes for:', symbols);
      const res = await fetch('/api/market/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });

      if (!res.ok) throw new Error('Market data fetch failed');

      const data = await res.json();
      console.log('[Portfolio] Quote result:', JSON.stringify(data).slice(0, 200));
      if (!data?.quotes || !mountedRef.current) return;

      const demoAccount = getDemoAccount(style, data.quotes);
      if (!demoAccount) return;

      setAccount(demoAccount);
      setError(null);
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load market data');
      }
    }
  }, [isConnected, user?.investorStyle]);

  // Fetch on mount and when user/style changes
  useEffect(() => {
    mountedRef.current = true;
    fetchData();

    // Refresh every 60s
    const interval = setInterval(fetchData, 60000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  return (
    <PortfolioContext.Provider value={{ account, loading, error, refresh: fetchData }}>
      {children}
    </PortfolioContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────

export function useLivePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) {
    throw new Error('useLivePortfolio must be used within PortfolioProvider');
  }
  return ctx;
}

/** Helper: build a compact markdown context string for the AI */
export function buildLivePortfolioContext(account: AccountSummary | null): string {
  if (!account || account.positions.length === 0) {
    return 'No portfolio data available.';
  }

  const priceAnchor = account.positions
    .map(p => `${p.symbol}: $${p.currentPrice.toFixed(2)}`)
    .join(' | ');

  const positionsSummary = account.positions
    .map(p =>
      `${p.symbol} (${p.name || p.symbol}): ${p.qty} shares @ $${p.currentPrice.toFixed(2)} | ` +
      `Value: $${p.marketValue.toFixed(0)} | ` +
      `Total P&L: ${p.totalPnl >= 0 ? '+' : ''}$${p.totalPnl.toFixed(0)} (${p.totalPnlPercent.toFixed(1)}%) | ` +
      `Today: ${p.dayChange >= 0 ? '+' : ''}$${p.dayChange.toFixed(0)} (${p.dayChangePercent.toFixed(1)}%) | ` +
      `Avg Cost: $${p.avgCost.toFixed(2)}`
    )
    .join('\n');

  const daySign = account.dayPnl >= 0 ? '+' : '';
  const totalSign = account.totalPnl >= 0 ? '+' : '';

  return `
⚠️ CURRENT MARKET PRICES (use these, ignore training data):
${priceAnchor}

PORTFOLIO CONTEXT (live Finnhub prices):
Total Value: $${account.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Today P&L: ${daySign}$${Math.abs(account.dayPnl).toFixed(2)} (${account.dayPnlPercent.toFixed(1)}%)
Total P&L: ${totalSign}$${Math.abs(account.totalPnl).toFixed(2)} (${account.totalPnlPercent.toFixed(1)}%)
Buying Power: $${account.buyingPower.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
Cash: $${account.cash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

POSITIONS (${account.positions.length} holdings):
${positionsSummary}
`.trim();
}
