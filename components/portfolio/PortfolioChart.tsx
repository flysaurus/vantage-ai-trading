'use client';

import { useState, useEffect, useCallback } from 'react';

import { apiPost } from '@/lib/api-client';
import PriceChart, { type ChartPoint, type ChartRange } from '../shared/PriceChart';

type Range = ChartRange;

interface PositionInput {
  symbol: string;
  shares: number;
  buyDate?: string;
  avgCost?: number;
  totalCost?: number;
}

interface Props {
  positions: PositionInput[];
  cashBalance: number;
}

const RANGES: Range[] = ['1D', '1W', '1M', 'YTD', 'ALL'];

// ─── Module-level cache (survives component unmount/remount) ───
interface CacheEntry {
  points: ChartPoint[];
  range: Range;
  date: string; // YYYY-MM-DD of fetch
  timestamp: number; // ms timestamp of fetch
  positionHash: string;
}

const chartCache = new Map<Range, CacheEntry>();

function makePositionHash(positions: PositionInput[], cashBalance: number): string {
  return JSON.stringify({
    c: cashBalance,
    p: positions.map(p => `${p.symbol}:${p.shares}:${p.avgCost}:${p.totalCost}`).sort().join(','),
  });
}

function isCacheValid(entry: CacheEntry, range: Range, positionHash: string): boolean {
  if (entry.range !== range) return false;
  if (entry.positionHash !== positionHash) return false;
  const today = new Date().toISOString().split('T')[0];
  if (entry.date !== today) return false; // new day = stale
  if (range === '1D') {
    return (Date.now() - entry.timestamp) < 5 * 60 * 1000; // 5 min TTL for 1D
  }
  return true; // 1W/1M/YTD/ALL valid for the day
}

// ─── Component ────────────────────────────────────────

export default function PortfolioChart({ positions, cashBalance }: Props) {
  const [range, setRange] = useState<Range>('1M');
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchChartData = useCallback(
    async (r: Range) => {
      if (!positions || positions.length === 0) return;

      setLoading(true);
      setError(false);
      try {
        const res = await apiPost('/api/portfolio/chart', {
          positions: positions.map((p) => ({
            symbol: p.symbol,
            shares: p.shares,
            buyDate: p.buyDate,
            avgCost: p.avgCost,
            totalCost: p.totalCost ?? p.shares * (p.avgCost ?? 0),
          })),
          cashBalance,
          range: r,
        });

        const json = await res.json();
        if (!json.points || json.points.length === 0) {
          if (json.error) setError(true);
          else setData([]);
          return;
        }

        setData(json.points);

        // Save to module cache (only points — return is derived by PriceChart)
        chartCache.set(r, {
          points: json.points,
          range: r,
          date: new Date().toISOString().split('T')[0],
          timestamp: Date.now(),
          positionHash: makePositionHash(positions, cashBalance),
        });
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [positions, cashBalance],
  );

  useEffect(() => {
    const posHash = makePositionHash(positions, cashBalance);
    const cached = chartCache.get(range);

    if (cached && isCacheValid(cached, range, posHash)) {
      // Restore from cache — no flicker
      setData(cached.points);
      setLoading(false);
      setError(false);
      return;
    }

    fetchChartData(range);
  }, [range, fetchChartData]);

  // ── Don't render if no positions ──
  if (!positions || positions.length === 0) return null;

  return (
    <PriceChart
      points={data}
      range={range}
      onRangeChange={(r) => {
        setRange(r);
        setData([]);
      }}
      loading={loading}
      error={error}
      height={120}
      gradientId="portfolioGradient"
    />
  );
}
