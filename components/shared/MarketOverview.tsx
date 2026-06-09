'use client';
import { useEffect, useState } from 'react';

interface IndexData {
  symbol: string;
  label: string;
  sublabel: string;
  value: number;
  change: number;
  changePct: number;
  isLive: boolean;
}

export default function MarketOverview() {
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIndices = async () => {
    try {
      const symbols = [
        { symbol: 'SPY', label: 'SPY', sublabel: 'S&P 500 ETF' },
        { symbol: 'QQQ', label: 'QQQ', sublabel: 'Nasdaq ETF' },
        { symbol: 'DIA', label: 'DIA', sublabel: 'Dow ETF' },
        { symbol: 'IWM', label: 'IWM', sublabel: 'Russell 2000' }
      ];
      const results = await Promise.all(
        symbols.map(async ({ symbol, label, sublabel }) => {
          const res = await fetch(
            `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
          );
          const data = await res.json();
          return {
            symbol,
            label,
            sublabel,
            value: data.c || data.pc || 0,
            change: data.c ? (data.d ?? 0) : 0,
            changePct: data.c ? (data.dp ?? 0) : 0,
            isLive: !!data.c
          };
        })
      );
      setIndices(results);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIndices();
    const interval = setInterval(fetchIndices, 60000);
    return () => clearInterval(interval);
  }, []);

  const gridStyle: React.CSSProperties = {
    margin: '12px 16px 0 16px',
    background: '#1a2235',
    border: '1px solid #2a3448',
    borderRadius: '10px',
    padding: '14px 16px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px'
  };

  if (loading) {
    return (
      <div style={gridStyle}>
        {['SPY', 'QQQ', 'DIA', 'IWM'].map((label, i) => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#334155', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '10px', color: '#334155', marginBottom: '4px' }}>
              {['S&P 500 ETF', 'Nasdaq ETF', 'Dow ETF', 'Russell 2000'][i]}
            </div>
            <div style={{ fontSize: '15px', color: '#334155' }}>—</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={gridStyle}>
      {indices.map((idx) => (
        <div key={idx.symbol} style={{ textAlign: 'center' }}>
          <div style={{
            fontSize: '13px',
            fontWeight: '700',
            color: '#ffffff'
          }}>
            {idx.label}
          </div>
          <div style={{
            fontSize: '10px',
            color: '#64748b',
            marginBottom: '4px'
          }}>
            {idx.sublabel}
          </div>
          <div style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#ffffff',
            marginBottom: '2px'
          }}>
            ${idx.value.toFixed(2)}
          </div>
          <div style={{
            fontSize: '11px',
            fontWeight: '500',
            color: idx.isLive
              ? (idx.change >= 0 ? '#10b981' : '#ef4444')
              : '#64748b'
          }}>
            {idx.isLive
              ? `${idx.change >= 0 ? '+' : ''}$${Math.abs(idx.change).toFixed(2)} (${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%)`
              : 'Closed'}
          </div>
        </div>
      ))}
    </div>
  );
}
