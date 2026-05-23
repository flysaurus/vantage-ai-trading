// ─── usePortfolio ─────────────────────────────────────────────
// Fetches real portfolio data from the broker adapter:
// account summary, positions, and calculated metrics.
// Replaces the previous mock data implementation.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePortfolioStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import type {
  AccountSummary,
  Position,
  SectorAllocation,
} from '@/types';

// Simple sector mapping for common stocks
// In production, this would come from a proper data source
const SECTOR_MAP: Record<string, string> = {
  AAPL: 'Tech',
  MSFT: 'Tech',
  GOOGL: 'Tech',
  GOOG: 'Tech',
  META: 'Tech',
  NVDA: 'Tech',
  AMD: 'Tech',
  INTC: 'Tech',
  CRM: 'Tech',
  ADBE: 'Tech',
  NFLX: 'Tech',
  TSLA: 'Consumer',
  AMZN: 'Consumer',
  JPM: 'Finance',
  BAC: 'Finance',
  GS: 'Finance',
  V: 'Finance',
  MA: 'Finance',
  UNH: 'Healthcare',
  JNJ: 'Healthcare',
  LLY: 'Healthcare',
  PFE: 'Healthcare',
  ABBV: 'Healthcare',
  XOM: 'Energy',
  CVX: 'Energy',
  COP: 'Energy',
  COKE: 'Consumer',
  KO: 'Consumer',
  PEP: 'Consumer',
  PG: 'Consumer',
  WMT: 'Consumer',
  COST: 'Consumer',
  DIS: 'Consumer',
  BA: 'Industrial',
  CAT: 'Industrial',
  GE: 'Industrial',
};

// Sorted colors for pie chart
const SECTOR_COLORS = [
  '#06b6d4', // cyan
  '#8b5cf6', // purple
  '#22c55e', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#3b82f6', // blue
  '#ef4444', // red
  '#64748b', // gray
];

const REFRESH_INTERVAL = 60000; // 60 seconds
const RETRY_DELAY = 3000;

export function usePortfolio() {
  const store = usePortfolioStore();
  const { account, setAccount, setLoading, updatePosition } = store;
  const { broker, connected } = useBroker();
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!broker || !connected) return;

    try {
      setLoading(true);
      setError(null);

      const [brokerAccount, brokerPositions] = await Promise.all([
        broker.getAccount(),
        broker.getPositions(),
      ]);

      if (!mountedRef.current) return;

      // Calculate total portfolio value for percentages
      const totalValue =
        brokerAccount.portfolioValue || brokerAccount.equity || 1;

      // Map positions to app format with sector info
      const positions: Position[] = brokerPositions.map((bp) => ({
        symbol: bp.symbol,
        name: bp.symbol,
        qty: bp.qty,
        avgCost: bp.avgCost,
        currentPrice: bp.currentPrice,
        marketValue: bp.marketValue,
        dayChange: bp.dayChange,
        dayChangePercent: bp.dayChangePercent,
        totalPnl: bp.totalPnl,
        totalPnlPercent: bp.totalPnlPercent,
        portfolioPercent:
          totalValue > 0 ? (bp.marketValue / totalValue) * 100 : 0,
        sector: SECTOR_MAP[bp.symbol] || 'Other',
      }));

      // Calculate sector allocation dynamically
      const sectorTotals: Record<string, number> = {};
      for (const pos of positions) {
        const sector = pos.sector || 'Other';
        sectorTotals[sector] =
          (sectorTotals[sector] || 0) + pos.marketValue;
      }

      const totalSectorValue = Object.values(sectorTotals).reduce(
        (sum: number, v: number): number => sum + v,
        0
      );

      const allocations: SectorAllocation[] = Object.entries(
        sectorTotals
      )
        .map(([sector, value], i) => ({
          sector,
          percent:
            totalSectorValue > 0
              ? Math.round((value / totalSectorValue) * 100)
              : 0,
          color: SECTOR_COLORS[i % SECTOR_COLORS.length],
        }))
        .sort((a, b) => b.percent - a.percent);

      const accountSummary: AccountSummary = {
        equity: brokerAccount.equity,
        buyingPower: brokerAccount.buyingPower,
        cash: brokerAccount.cash,
        dayPnl: brokerAccount.dayPnl,
        dayPnlPercent: brokerAccount.dayPnlPercent,
        totalPnl: brokerAccount.totalPnl,
        totalPnlPercent: brokerAccount.totalPnlPercent,
        positions,
      };

      setAccount({
        ...accountSummary,
        sectorAllocations: allocations,
      } as AccountSummary & { sectorAllocations: SectorAllocation[] });
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : 'Failed to load portfolio';
      console.error('[usePortfolio] Error:', message);
      setError(message);
      setLoading(false);

      // Retry after delay
      retryTimer.current = setTimeout(() => {
        if (mountedRef.current) refresh();
      }, RETRY_DELAY);
    }
  }, [broker, connected, setAccount, setLoading]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    if (connected) {
      refresh();
    }
    return () => {
      mountedRef.current = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
    };
  }, [connected, refresh]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // Update individual position via store (for live quote updates)
  const updateQuoteForPosition = useCallback(
    (symbol: string, price: number, change: number, changePct: number) => {
      updatePosition(symbol, {
        currentPrice: price,
        dayChange: change,
        dayChangePercent: changePct,
      });
    },
    [updatePosition]
  );

  return {
    account,
    loading: store.loading || false,
    error,
    refresh,
    updateQuoteForPosition,
  };
}
