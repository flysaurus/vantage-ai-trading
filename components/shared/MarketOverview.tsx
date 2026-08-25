'use client';
import { useEffect, useState } from 'react';
import IndexDetail from './IndexDetail';

interface IndexData {
  symbol: string;
  label: string;
  name: string;
  ticker?: string;
  value: number;
  change: number;
  changePct: number;
  isLive: boolean;
}

// ── module-level cache survives tab-switch unmounts ──
let cachedIndices: IndexData[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000;

export default function MarketOverview() {
  const [indices, setIndices] = useState<IndexData[]>(
    cachedIndices || []
  );
  const [loading, setLoading] = useState(!cachedIndices);
  const [selectedIndex, setSelectedIndex] = useState<IndexData | null>(null);

  const fetchIndices = async () => {
    try {
      const symbols = [
        { symbol: 'SPY', label: 'S&P 500', name: 'SPY', ticker: 'SPY' },
        { symbol: 'QQQ', label: 'Nasdaq', name: 'QQQ', ticker: 'QQQ' },
        { symbol: 'DIA', label: 'Dow Jones', name: 'DIA', ticker: 'DIA' },
        { symbol: 'IWM', label: 'Russell 2000', name: 'IWM', ticker: 'IWM' }
      ];
      const results = await Promise.all(
        symbols.map(async ({ symbol, label, name, ticker }) => {
          const res = await fetch(
            `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
          );
          const data = await res.json();
          return {
            symbol,
            label,
            name,
            ticker,
            value: data.c || data.pc || 0,
            change: data.c ? (data.d ?? 0) : 0,
            changePct: data.c ? (data.dp ?? 0) : 0,
            isLive: !!data.c
          };
        })
      );
      setIndices(results);
      cachedIndices = results;
      cacheTime = Date.now();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cachedIndices || Date.now() - cacheTime >= CACHE_TTL) {
      fetchIndices();
    }
    const interval = setInterval(fetchIndices, CACHE_TTL);
    return () => clearInterval(interval);
  }, []);

  const handleIndexPress = (idx: IndexData) => {
    setSelectedIndex(idx);
  };

  return (
    <div style={{ padding: '0 16px 20px' }}>
      {/* Section Header */}
      <h2 className="section-header" style={{ padding: '20px 0 12px' }}>
        Market Overview
      </h2>

      {/* Compact full-width list rows — one index per row */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading
          ? [1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="card-frost-sm"
                style={{
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#334155' }}>—</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>—</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#334155' }}>—</div>
                </div>
              </div>
            ))
          : indices.map((idx) => (
              <button
                key={idx.symbol}
                type="button"
                onClick={() => handleIndexPress(idx)}
                className="card-frost-sm"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                }}
              >
                {/* Name + ticker (legible, larger) */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: '#ffffff',
                      fontFamily: 'var(--font-sans)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idx.label}
                  </span>
                  {idx.ticker && (
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
                      {idx.ticker}
                    </span>
                  )}
                </div>

                {/* Value + change (right-aligned) */}
                <div style={{ textAlign: 'right', minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 700,
                      fontSize: 16,
                      color: '#ffffff',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ${idx.value.toFixed(2)}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      fontSize: 12,
                      color: idx.isLive
                        ? (idx.change >= 0 ? 'var(--gain)' : 'var(--loss)')
                        : 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idx.isLive
                      ? `${idx.change >= 0 ? '+' : ''}$${Math.abs(idx.change).toFixed(2)} (${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%)`
                      : 'Closed'}
                  </div>
                </div>
              </button>
            ))}
      </div>

      {/* Index detail overlay (renders on top; page keeps rendering beneath) */}
      {selectedIndex && (
        <IndexDetail
          symbol={selectedIndex.symbol}
          label={selectedIndex.label}
          name={selectedIndex.name}
          ticker={selectedIndex.ticker}
          value={selectedIndex.value}
          change={selectedIndex.change}
          changePct={selectedIndex.changePct}
          isLive={selectedIndex.isLive}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </div>
  );
}
