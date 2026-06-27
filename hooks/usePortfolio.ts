// ─── usePortfolio ─────────────────────────────────────────────
// Fetches real portfolio data from the broker adapter:
// account summary, positions, and calculated metrics.
// Fetches live data from the broker.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePortfolioStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { getDemoAccount, getDemoSectorAllocations, getDemoSymbols } from '@/lib/demo-data';
import type {
  AccountSummary,
  Position,
  SectorAllocation,
} from '@/types';

const SECTOR_MAP: Record<string, string> = {
  // Technology
  AAPL: 'Technology',
  MSFT: 'Technology',
  GOOGL: 'Technology',
  GOOG: 'Technology',
  META: 'Technology',
  NVDA: 'Technology',
  AMD: 'Technology',
  INTC: 'Technology',
  CRM: 'Technology',
  ADBE: 'Technology',
  AVGO: 'Technology',
  TSEM: 'Technology',
  NET: 'Technology',
  PLTR: 'Technology',
  SNOW: 'Technology',
  UBER: 'Technology',
  SHOP: 'Technology',
  SQ: 'Technology',
  PYPL: 'Technology',
  NOW: 'Technology',
  INTU: 'Technology',
  ORCL: 'Technology',
  IBM: 'Technology',
  CSCO: 'Technology',
  QCOM: 'Technology',
  TXN: 'Technology',
  MU: 'Technology',
  LRCX: 'Technology',
  AMAT: 'Technology',
  KLAC: 'Technology',
  MRVL: 'Technology',
  CRWD: 'Technology',
  ZS: 'Technology',
  PANW: 'Technology',
  FTNT: 'Technology',
  DDOG: 'Technology',
  TEAM: 'Technology',
  WDAY: 'Technology',
  ZM: 'Technology',
  OKTA: 'Technology',
  TWLO: 'Technology',
  // Consumer
  TSLA: 'Consumer',
  AMZN: 'Consumer',
  COKE: 'Consumer',
  KO: 'Consumer',
  PEP: 'Consumer',
  PG: 'Consumer',
  WMT: 'Consumer',
  COST: 'Consumer',
  DIS: 'Consumer',
  HD: 'Consumer',
  MCD: 'Consumer',
  NKE: 'Consumer',
  SBUX: 'Consumer',
  TGT: 'Consumer',
  LOW: 'Consumer',
  LULU: 'Consumer',
  CMG: 'Consumer',
  YUM: 'Consumer',
  BKNG: 'Consumer',
  ABNB: 'Consumer',
  RCL: 'Consumer',
  MAR: 'Consumer',
  DPZ: 'Consumer',
  EL: 'Consumer',
  CL: 'Consumer',
  GIS: 'Consumer',
  K: 'Consumer',
  MDLZ: 'Consumer',
  HSY: 'Consumer',
  CROX: 'Consumer',
  DECK: 'Consumer',
  // Financial Services
  JPM: 'Financial Services',
  BAC: 'Financial Services',
  GS: 'Financial Services',
  MS: 'Financial Services',
  C: 'Financial Services',
  WFC: 'Financial Services',
  AXP: 'Financial Services',
  V: 'Financial Services',
  MA: 'Financial Services',
  BLK: 'Financial Services',
  SCHW: 'Financial Services',
  PNC: 'Financial Services',
  USB: 'Financial Services',
  TFC: 'Financial Services',
  COF: 'Financial Services',
  DFS: 'Financial Services',
  AIG: 'Financial Services',
  MET: 'Financial Services',
  PRU: 'Financial Services',
  SPGI: 'Financial Services',
  MCO: 'Financial Services',
  BK: 'Financial Services',
  // Healthcare
  UNH: 'Healthcare',
  JNJ: 'Healthcare',
  LLY: 'Healthcare',
  PFE: 'Healthcare',
  ABBV: 'Healthcare',
  MRK: 'Healthcare',
  TMO: 'Healthcare',
  ABT: 'Healthcare',
  ISRG: 'Healthcare',
  GILD: 'Healthcare',
  BNTX: 'Healthcare',
  MRNA: 'Healthcare',
  REGN: 'Healthcare',
  VRTX: 'Healthcare',
  BMY: 'Healthcare',
  AMGN: 'Healthcare',
  CI: 'Healthcare',
  HUM: 'Healthcare',
  ZTS: 'Healthcare',
  CVS: 'Healthcare',
  DXCM: 'Healthcare',
  EW: 'Healthcare',
  BSX: 'Healthcare',
  SYK: 'Healthcare',
  MDT: 'Healthcare',
  // Energy
  XOM: 'Energy',
  CVX: 'Energy',
  COP: 'Energy',
  SLB: 'Energy',
  EOG: 'Energy',
  MPC: 'Energy',
  PSX: 'Energy',
  VLO: 'Energy',
  OXY: 'Energy',
  PXD: 'Energy',
  HES: 'Energy',
  FANG: 'Energy',
  DVN: 'Energy',
  KMI: 'Energy',
  WMB: 'Energy',
  // Industrials
  BA: 'Industrials',
  CAT: 'Industrials',
  GE: 'Industrials',
  ETN: 'Industrials',
  DE: 'Industrials',
  HON: 'Industrials',
  UPS: 'Industrials',
  RTX: 'Industrials',
  LMT: 'Industrials',
  MM: 'Industrials',
  ITW: 'Industrials',
  EMR: 'Industrials',
  NOC: 'Industrials',
  GD: 'Industrials',
  FDX: 'Industrials',
  NSC: 'Industrials',
  UNP: 'Industrials',
  // Utilities
  NEE: 'Utilities',
  DUK: 'Utilities',
  SO: 'Utilities',
  D: 'Utilities',
  AEP: 'Utilities',
  EXC: 'Utilities',
  SRE: 'Utilities',
  PCG: 'Utilities',
  ED: 'Utilities',
  XEL: 'Utilities',
  CEG: 'Utilities',
  // Materials
  LIN: 'Materials',
  SHW: 'Materials',
  FCX: 'Materials',
  NEM: 'Materials',
  DOW: 'Materials',
  DD: 'Materials',
  APD: 'Materials',
  // Real Estate
  PLD: 'Real Estate',
  AMT: 'Real Estate',
  CCI: 'Real Estate',
  EQIX: 'Real Estate',
  SPG: 'Real Estate',
  O: 'Real Estate',
  WELL: 'Real Estate',
  // Media & Entertainment
  NFLX: 'Media & Entertainment',
  CMCSA: 'Media & Entertainment',
  T: 'Media & Entertainment',
  VZ: 'Media & Entertainment',
  TMUS: 'Media & Entertainment',
  CHTR: 'Media & Entertainment',
  PARA: 'Media & Entertainment',
  WBD: 'Media & Entertainment',
  SPOT: 'Media & Entertainment',
  // Automotive
  F: 'Automotive',
  GM: 'Automotive',
  RIVN: 'Automotive',
  LCID: 'Automotive',
  FSR: 'Automotive',
};

const SECTOR_COLORS = [
  '#06b6d4', // Technology — cyan
  '#8b5cf6', // Healthcare — purple
  '#22c55e', // Financial Services — green
  '#f59e0b', // Consumer — amber
  '#ec4899', // Industrials — pink
  '#3b82f6', // Energy — blue
  '#ef4444', // Utilities — red
  '#14b8a6', // Real Estate — teal
  '#a855f7', // Materials — violet
  '#f97316', // Media & Entertainment — orange
  '#84cc16', // Automotive — lime
  '#64748b', // Other — gray
];

const REFRESH_INTERVAL = 60000; // 60 seconds
const RETRY_DELAY = 3000;

export function usePortfolio() {
  const store = usePortfolioStore();
  const { account, setAccount, setLoading, updatePosition } = store;
  const { broker, isConnected } = useBroker();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Demo data when no broker connected ────────────────────
  useEffect(() => {
    if (isConnected) return;

    const style = user?.investorStyle || 'buffett';
    const symbols = getDemoSymbols(style as any);

    fetch('/api/market/quotes', { credentials: 'include',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(res))
      .then(data => {
        if (!data?.quotes || !mountedRef.current) return;
        const demoAccount = getDemoAccount(style as any, data.quotes);
        if (!demoAccount) return;
        const allocations = getDemoSectorAllocations(demoAccount);
        setAccount({
          ...demoAccount,
          sectorAllocations: allocations,
        } as AccountSummary & { sectorAllocations: SectorAllocation[] });
      })
      .catch(() => {
        if (mountedRef.current) {
          setError('Market data unavailable. Please try again.');
        }
      });
  }, [isConnected, user?.investorStyle, setAccount]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!broker || !isConnected) return;

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

      // Map positions to app format with sector info (hardcoded map first)
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

      // Resolve unknown sectors from Alpaca asset data
      const unknownSymbols = positions
        .filter(p => !p.sector || p.sector === 'Other')
        .map(p => p.symbol);
      
      if (unknownSymbols.length > 0) {
        try {
          const res = await fetch(`/api/sectors?symbols=${unknownSymbols.join(',')}`);
          if (res.ok) {
            const data = await res.json();
            const resolved: Record<string, string | null> = data.sectors || {};
            for (const pos of positions) {
              if ((!pos.sector || pos.sector === 'Other') && resolved[pos.symbol]) {
                pos.sector = resolved[pos.symbol]!;
              }
            }
          }
        } catch {
          // Keep 'Other' if sector API fails
        }
      }

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
  }, [broker, isConnected, setAccount, setLoading]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    if (isConnected) {
      refresh();
    }
    return () => {
      mountedRef.current = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
    };
  }, [isConnected, refresh]);

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
