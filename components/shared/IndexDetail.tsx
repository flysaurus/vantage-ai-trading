'use client';

import { useState, useEffect, useCallback } from 'react';

import PriceChart, { type ChartPoint, type ChartRange } from './PriceChart';

interface IndexDetailProps {
  symbol: string;
  label: string;
  name: string;
  ticker?: string;
  value: number;
  change: number;
  changePct: number;
  isLive: boolean;
  onClose: () => void;
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
 * Index detail panel: header (price/change) + scrubbable area chart
 * across 5 timeframes (1D default). Reuses the shared PriceChart.
 *
 * Renders inline (accordion expansion) beneath the tapped index row —
 * no full-screen modal; the surrounding list stays in the flow.
 */
export default function IndexDetail({
  symbol,
  label,
  name,
  ticker,
  value,
  change,
  changePct,
  isLive,
  onClose,
}: IndexDetailProps) {
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

  const isUp = change >= 0;
  const displayPrice = value || 0;

  return (
    <div
      style={{
        background: 'var(--bg-card, #1a2235)',
        borderRadius: 16,
        border: '1px solid rgba(34,211,238,0.35)',
        padding: '16px 14px 14px',
        marginTop: 2,
      }}
    >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 8,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 20,
                  fontWeight: 700,
                  color: '#ffffff',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {label}
              </h2>
              {ticker && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--text-accent-warm)',
                    background: 'rgba(251, 191, 36, 0.12)',
                    padding: '2px 7px',
                    borderRadius: 5,
                    letterSpacing: 0.3,
                  }}
                >
                  {ticker}
                </span>
              )}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>
              {name}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse"
            style={{
              background: 'rgba(148, 163, 184, 0.12)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#cbd5e1',
              fontSize: 16,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Price + change */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 22,
              color: '#ffffff',
            }}
          >
            ${displayPrice.toFixed(2)}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 14,
              color: isLive ? (isUp ? 'var(--gain)' : 'var(--loss)') : 'var(--text-muted)',
            }}
          >
            {isLive
              ? `${isUp ? '+' : ''}$${Math.abs(change).toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}%)`
              : 'Closed'}
          </span>
        </div>

        {/* Chart */}
        <PriceChart
          points={points}
          range={range}
          onRangeChange={(r) => {
            setRange(r);
            setPoints([]);
          }}
          loading={loading}
          error={error}
          height={220}
          gradientId="indexChartGradient"
          valuePrefix="$"
        />
    </div>
  );
}
