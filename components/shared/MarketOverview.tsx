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

  // Toggle: tapping the same row again collapses it (inline accordion)
  const handleIndexPress = (idx: IndexData) => {
    setSelectedIndex((cur) => (cur?.symbol === idx.symbol ? null : idx));
  };

  return (
    <div style={{ padding: '0 14px 20px' }}>
      {/* Section Header */}
      <h2 className="section-header" style={{ padding: '20px 0 12px' }}>
        Market Overview
      </h2>

      {/* Compact list rows — same sizing as portfolio position cards (e.g. AAPL) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading
          ? [1, 2, 3, 4].map((i) => (
              <div
                key={i}
                style={{
                  background: 'var(--bg-card, #1a2235)',
                  borderRadius: 16,
                  border: '1px solid rgba(255,255,255,0.06)',
                  padding: '12px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: '#334155' }}>—</span>
                <span style={{ fontSize: '12.5px', fontWeight: 700, color: '#334155' }}>—</span>
              </div>
            ))
          : indices.map((idx) => {
              const expanded = selectedIndex?.symbol === idx.symbol;
              return (
                <div
                  key={idx.symbol}
                  style={{
                    background: 'var(--bg-card, #1a2235)',
                    borderRadius: 16,
                    border: expanded
                      ? '1px solid rgba(34,211,238,0.35)'
                      : '1px solid rgba(255,255,255,0.06)',
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleIndexPress(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      background: 'transparent',
                      border: 'none',
                    }}
                  >
                    {/* Name + ticker (left) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '13.5px',
                          color: '#ffffff',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {idx.label}
                      </span>
                      {idx.ticker && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: 'rgba(251, 191, 36, 0.12)',
                            color: '#fbbf24',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                            lineHeight: 1.4,
                          }}
                        >
                          {idx.ticker}
                        </span>
                      )}
                    </div>

                    {/* Value + change + chevron (right) */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexShrink: 0,
                        marginLeft: 12,
                      }}
                    >
                      <div style={{ textAlign: 'right' }}>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '12.5px',
                            color: '#ffffff',
                            fontFamily: 'var(--mono-font, monospace)',
                          }}
                        >
                          ${idx.value.toFixed(2)}
                        </div>
                        <div
                          style={{
                            fontSize: '9.5px',
                            fontWeight: 600,
                            color: idx.isLive
                              ? (idx.change >= 0 ? 'var(--gain, #10b981)' : 'var(--loss, #ef4444)')
                              : 'var(--faint, #8794a8)',
                            marginTop: 1,
                          }}
                        >
                          {idx.isLive
                            ? `${idx.change >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%`
                            : 'Closed'}
                        </div>
                      </div>
                      <span
                        style={{
                          color: 'var(--dim, #aab4c7)',
                          fontSize: 14,
                          lineHeight: 1,
                          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
                          transition: 'transform 0.25s',
                          flexShrink: 0,
                        }}
                      >
                        ▾
                      </span>
                    </div>
                  </button>

                  {/* Inline expansion — chart renders inside this card, no modal */}
                  {expanded && <IndexDetail symbol={idx.symbol} />}
                </div>
              );
            })}
      </div>
    </div>
  );
}
