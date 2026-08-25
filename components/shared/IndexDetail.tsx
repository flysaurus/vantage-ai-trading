'use client';

import { useState, useEffect, useCallback } from 'react';

import PriceChart, { type ChartPoint, type ChartRange } from './PriceChart';

interface IndexDetailProps {
  symbol: string;
}

// ─── Timeframe → Alpaca bars params ─────────────────────
function getBarsParams(range: ChartRange): { tf: string; start: string; limit: number } {
  const now = new Date();
  switch (range) {
    case '1D': {
      const s = new Date(now.getTime() - 1 * 86400_000);
      return { tf: '5Min', start: s.toISOString(), limit: 400 };
    }
    case '1W': {
      const s = new Date(now.getTime() - 7 * 86400_000);
      return { tf: '15Min', start: s.toISOString(), limit: 500 };
    }
    case '1M': {
      const s = new Date(now.getTime() - 35 * 86400_000);
      return { tf: '1Day', start: s.toISOString(), limit: 40 };
    }
    case 'YTD': {
      const s = new Date(now.getFullYear(), 0, 1);
      return { tf: '1Day', start: s.toISOString(), limit: 250 };
    }
    case 'ALL': {
      const s = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
      return { tf: '1Week', start: s.toISOString(), limit: 300 };
    }
  }
}

// ─── Module-level cache (survives open/close) ────────────
interface IndexCacheEntry {
  points: ChartPoint[];
  range: ChartRange;
  date: string;
  timestamp: number;
}

const indexChartCache = new Map<string, IndexCacheEntry>(); // `${symbol}:${range}`

function isCacheValid(entry: IndexCacheEntry, range: ChartRange): boolean {
  if (entry.range !== range) return false;
  const today = new Date().toISOString().split('T')[0];
  if (entry.date !== today) return false;
  if (range === '1D') {
    return (Date.now() - entry.timestamp) < 5 * 60 * 1000; // 5 min TTL for 1D
  }
  return true;
}

/**
 * Inline index chart panel: scrubbable area chart + range pills only.
 * Rendered inside the parent index card (no duplicate header/price/change).
 */
export default function IndexDetail({ symbol }: IndexDetailProps) {
  const [range, setRange] = useState<ChartRange>('1D');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchBars = useCallback(
    async (r: ChartRange) => {
      const { tf, start, limit } = getBarsParams(r);
      const url =
        `/api/alpaca/market?symbol=${encodeURIComponent(symbol)}` +
        `&bars=${tf}&start=${encodeURIComponent(start)}&limit=${limit}`;

      setLoading(true);
      setError(false);
      try {
        const res = await fetch(url);
        const json = await res.json();

        const rawBars: Array<{ timestamp: string; close: number }> =
          json?.bars || [];

        if (!res.ok || rawBars.length === 0) {
          setError(true);
          setPoints([]);
          return;
        }

        const mapped: ChartPoint[] = rawBars
          .map((b) => ({
            timestamp: Math.floor(new Date(b.timestamp).getTime() / 1000),
            value: b.close,
          }))
          .filter((p) => Number.isFinite(p.timestamp) && Number.isFinite(p.value) && p.value > 0)
          .sort((a, b) => a.timestamp - b.timestamp);

        setPoints(mapped);
        indexChartCache.set(`${symbol}:${r}`, {
          points: mapped,
          range: r,
          date: new Date().toISOString().split('T')[0],
          timestamp: Date.now(),
        });
      } catch {
        setError(true);
        setPoints([]);
      } finally {
        setLoading(false);
      }
    },
    [symbol],
  );

  useEffect(() => {
    const cached = indexChartCache.get(`${symbol}:${range}`);
    if (cached && isCacheValid(cached, range)) {
      setPoints(cached.points);
      setLoading(false);
      setError(false);
      return;
    }
    fetchBars(range);
  }, [range, fetchBars, symbol]);

  return (
    <div
      style={{
        padding: '0 14px 14px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: 12,
      }}
    >
      <PriceChart
        points={points}
        range={range}
        onRangeChange={(r) => {
          setRange(r);
          setPoints([]);
        }}
        loading={loading}
        error={error}
        height={110}
        gradientId="indexChartGradient"
        valuePrefix="$"
      />
    </div>
  );
}
