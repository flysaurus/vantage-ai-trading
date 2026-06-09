'use client';
import { useEffect, useState } from 'react';

interface IndexData {
  symbol: string;
  label: string;
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
        { symbol: '^DJI', label: 'DOW' },
        { symbol: '^GSPC', label: 'S&P 500' },
        { symbol: '^IXIC', label: 'NASDAQ' }
      ];
      const results = await Promise.all(
        symbols.map(async ({ symbol, label }) => {
          const res = await fetch(
            `/api/finnhub/quote?symbol=${encodeURIComponent(symbol)}`
          );
          const data = await res.json();
          return {
            symbol,
            label,
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

  if (loading) {
    return (
      <div style={{
        margin: '12px 16px 0 16px',
        background: '#1a2235',
        border: '1px solid #2a3448',
        borderRadius: '10px',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        {['DOW', 'S&P 500', 'NASDAQ'].map(label => (
          <div key={label} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: '#334155', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '14px', color: '#334155' }}>—</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{
      margin: '12px 16px 0 16px',
      background: '#1a2235',
      border: '1px solid #2a3448',
      borderRadius: '10px',
      padding: '12px 16px',
      display: 'flex',
      justifyContent: 'space-between'
    }}>
      {indices.map((idx) => (
        <div key={idx.symbol} style={{ textAlign: 'center', flex: 1 }}>
          <div style={{
            fontSize: '10px',
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: '4px'
          }}>
            {idx.label}
          </div>
          <div style={{
            fontSize: '15px',
            fontWeight: '700',
            color: '#ffffff',
            marginBottom: '2px'
          }}>
            {idx.value >= 1000
              ? idx.value.toLocaleString('en-US', {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                })
              : idx.value.toFixed(2)}
          </div>
          <div style={{
            fontSize: '11px',
            fontWeight: '500',
            color: idx.isLive
              ? (idx.change >= 0 ? '#10b981' : '#ef4444')
              : '#64748b'
          }}>
            {idx.isLive
              ? `${idx.change >= 0 ? '+' : ''}${idx.change.toFixed(0)} (${idx.changePct >= 0 ? '+' : ''}${idx.changePct.toFixed(2)}%)`
              : 'Closed'}
          </div>
        </div>
      ))}
    </div>
  );
}
