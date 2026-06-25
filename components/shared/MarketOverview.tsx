'use client';
import { useEffect, useState } from 'react';

interface IndexData {
  symbol: string;
  label: string;
  name: string;
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

  const fetchIndices = async () => {
    try {
      const symbols = [
        { symbol: 'SPY', label: 'S&P 500', name: 'SPY' },
        { symbol: 'QQQ', label: 'Nasdaq', name: 'QQQ' },
        { symbol: 'DIA', label: 'Dow Jones', name: 'DIA' },
        { symbol: 'IWM', label: 'Russell 2000', name: 'IWM' }
      ];
      const results = await Promise.all(
        symbols.map(async ({ symbol, label, name }) => {
          const res = await fetch(
            `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
          );
          const data = await res.json();
          return {
            symbol,
            label,
            name,
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

  return (
    <div style={{ padding: '0 20px 20px' }}>
      {/* Section Header */}
      <h2 className="section-header" style={{ padding: '20px 0 12px' }}>
        Market Overview
      </h2>

      {/* 2×2 Grid of Frosted Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 10,
      }}>
        {loading
          ? [1, 2, 3, 4].map((i) => (
              <div key={i} className="card-frost-sm" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <div className="section-label" style={{ marginBottom: 4 }}>—</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#334155' }}>—</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>—</div>
              </div>
            ))
          : indices.map((idx) => (
              <div key={idx.symbol} className="card-frost-sm" style={{ padding: '14px 16px', textAlign: 'center' }}>
                <div className="section-label" style={{ marginBottom: 4 }}>
                  {idx.label}
                </div>
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 700,
                  fontSize: 20,
                  color: '#ffffff',
                  marginBottom: 2,
                }}>
                  ${idx.value.toFixed(2)}
                </div>
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 600,
                  fontSize: 13,
                  color: idx.isLive
                    ? (idx.change >= 0 ? 'var(--gain)' : 'var(--loss)')
                    : 'var(--text-muted)',
                }}>
                  {idx.isLive
                    ? `${idx.change >= 0 ? '+' : ''}$${Math.abs(idx.change).toFixed(2)} (${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%)`
                    : 'Closed'}
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
