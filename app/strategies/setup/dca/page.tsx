'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, TrendingDown, Loader2, DollarSign, BarChart3, Activity, Layers } from 'lucide-react';
import { SymbolSearch } from '@/components/trade/SymbolSearch';
import { usePortfolio } from '@/hooks/usePortfolio';

interface StockDetails {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  eps: number | null;
  pe: number | null;
  high52w: number | null;
  low52w: number | null;
}

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return n.toFixed(decimals);
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toFixed(2)}`;
}

function fmtMarketCap(n: number | null | undefined): string {
  if (n == null || n <= 0) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n.toFixed(0)}`;
}

export default function DcaSetupPage() {
  const router = useRouter();
  const { account } = usePortfolio();
  const holdings = account?.positions || [];

  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [stockDetails, setStockDetails] = useState<StockDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSymbolSelect = useCallback(async (symbol: string) => {
    setSelectedSymbol(symbol);
    setError(null);
    setLoading(true);
    setStockDetails(null);

    try {
      const res = await fetch(`/api/stock/details?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || 'Failed to load stock details');
        return;
      }

      if (data.price == null) {
        setError(`No market data available for ${symbol}. Check the symbol and try again.`);
        return;
      }

      setStockDetails(data);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const position = holdings.find(p => p.symbol === selectedSymbol);
  const changeColor = (stockDetails?.changePercent ?? 0) >= 0 ? '#4ade80' : '#f87171';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#f1f5f9',
        padding: '16px 16px 96px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ─── Back + Header ─────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => router.back()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '6px 0',
            marginBottom: 16,
            fontFamily: 'inherit',
          }}
        >
          <ArrowLeft size={16} />
          Back
        </button>

        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>
          Dollar Cost Averaging
        </h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
          Automate recurring investments
        </p>
      </div>

      {/* ─── Section 1: Stock Selection ────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#06b6d4',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 10,
          }}
        >
          <Layers size={12} style={{ marginRight: 6, display: 'inline' }} />
          Stock Selection
        </div>

        <SymbolSearch
          value={selectedSymbol}
          onChange={handleSymbolSelect}
          placeholder="Search for a stock or ETF..."
          positions={holdings.map(p => p.symbol)}
        />
      </div>

      {/* ─── Loading State ─────────────────────────────── */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '32px 0',
            color: '#94a3b8',
            fontSize: 13,
          }}
        >
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
          Loading {selectedSymbol}...
        </div>
      )}

      {/* ─── Error ─────────────────────────────────────── */}
      {error && (
        <div
          style={{
            padding: 12,
            background: 'rgba(248,113,113,0.1)',
            border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8,
            color: '#f87171',
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* ─── Stock Summary Card ────────────────────────── */}
      {stockDetails && (
        <div
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20,
          }}
        >
          {/* Symbol + Name */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#f1f5f9' }}>
                {stockDetails.symbol}
              </div>
              {stockDetails.name && (
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {stockDetails.name}
                </div>
              )}
            </div>
            {stockDetails.sector && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#06b6d4',
                  background: 'rgba(6,182,212,0.1)',
                  border: '1px solid rgba(6,182,212,0.25)',
                  borderRadius: 6,
                  padding: '3px 10px',
                }}
              >
                {stockDetails.sector}
              </span>
            )}
          </div>

          {/* Price + Change */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 14,
              padding: '10px 12px',
              background: '#0f172a',
              borderRadius: 8,
            }}
          >
            <DollarSign size={14} style={{ color: '#06b6d4' }} />
            <span style={{ fontSize: 20, fontWeight: 800, color: '#f1f5f9' }}>
              {fmtCurrency(stockDetails.price)}
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                fontSize: 13,
                fontWeight: 700,
                color: changeColor,
              }}
            >
              {stockDetails.changePercent != null &&
                (stockDetails.changePercent >= 0 ? (
                  <TrendingUp size={14} />
                ) : (
                  <TrendingDown size={14} />
                ))}
              {stockDetails.change != null
                ? `${stockDetails.change >= 0 ? '+' : ''}${fmt(stockDetails.change)} (${stockDetails.changePercent != null && stockDetails.changePercent >= 0 ? '+' : ''}${fmt(stockDetails.changePercent)}%)`
                : '—'}
            </span>
          </div>

          {/* Details Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px 12px',
              marginBottom: 14,
            }}
          >
            <Detail label="EPS" value={`$${fmt(stockDetails.eps)}`} />
            <Detail label="P/E" value={fmt(stockDetails.pe)} />
            <Detail label="52w High" value={fmtCurrency(stockDetails.high52w)} />
            <Detail label="52w Low" value={fmtCurrency(stockDetails.low52w)} />
            <Detail label="Mkt Cap" value={fmtMarketCap(stockDetails.marketCap)} />
            <Detail label="Prev Close" value={fmtCurrency(stockDetails.previousClose)} />
          </div>

          {/* Portfolio Check */}
          {position && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'rgba(6,182,212,0.08)',
                border: '1px solid rgba(6,182,212,0.2)',
                borderRadius: 8,
              }}
            >
              <Activity size={14} style={{ color: '#06b6d4' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#06b6d4' }}>
                Already in portfolio: {position.qty != null ? `${position.qty} shares` : 'held'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Spinner keyframes */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{value}</span>
    </div>
  );
}
