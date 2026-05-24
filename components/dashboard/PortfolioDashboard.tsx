'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useStockRecommendations } from '@/hooks/useStockRecommendations';
import { StockRecommendationCard } from '@/components/advisor/StockRecommendationCard';
import ConflictAlert from '@/components/advisor/ConflictAlert';
import { detectConflict, type ConflictAnalysis } from '@/lib/advisor/conflict-detection';
import { useTabStore } from '@/store';
import type { InvestorStyle } from '@/types';

interface Position {
  symbol: string;
  name?: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  dayChange: number;
  dayChangePercent: number;
  totalPnl: number;
  totalPnlPercent: number;
  portfolioPercent: number;
  sector?: string;
}

interface Props {
  positions: Position[];
  totalValue: number;
  totalGain: number;
  totalReturn: number;
}

const STYLE_NAMES: Record<string, string> = {
  buffett: 'Warren Buffett',
  lynch: 'Peter Lynch',
  livermore: 'Jesse Livermore',
  soros: 'George Soros',
  munger: 'Charlie Munger',
};

const STYLE_EMOJIS: Record<string, string> = {
  buffett: '💎',
  lynch: '📈',
  livermore: '⚡️',
  soros: '🌍',
  munger: '💰',
};

// ─── Position Row ─────────────────────────────────────────────

function PositionRow({
  position,
  selectedStyle,
  onDataLoaded,
}: {
  position: Position;
  selectedStyle: InvestorStyle;
  onDataLoaded?: (symbol: string, data: Record<string, unknown>) => void;
}) {
  const { recommendations, stockData, isLoading, isError, error } = useStockRecommendations(position.symbol, true);

  // Report stock data upward for conflict detection
  useEffect(() => {
    if (stockData && onDataLoaded) {
      onDataLoaded(position.symbol, {
        dividendYield: (stockData as any).dividendYield,
        pe: (stockData as any).pe,
        pb: (stockData as any).pb,
        revenueGrowth: (stockData as any).revenueGrowth,
        payoutRatio: (stockData as any).payoutRatio,
        currentPrice: stockData.currentPrice,
        price200ma: stockData.price200ma,
      });
    }
  }, [stockData, position.symbol, onDataLoaded]);

  return (
    <div
      style={{
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: 12,
        padding: 14,
      }}
    >
      {/* Mini header with position stats */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{position.symbol}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {position.qty} shares · {position.portfolioPercent.toFixed(1)}% of portfolio
            </span>
          </div>
          {position.sector && (
            <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{position.sector}</span>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            ${position.marketValue.toFixed(0)}
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: position.totalPnl >= 0 ? '#22c55e' : '#ef4444',
            }}
          >
            {position.totalPnl >= 0 ? '+' : ''}
            ${position.totalPnl.toFixed(2)} ({position.totalPnl >= 0 ? '+' : ''}
            {position.totalPnlPercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      {/* Recommendation card */}
      {isLoading && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          Loading recommendations...
        </div>
      )}

      {isError && (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          Could not load recommendations{error ? `: ${error}` : ''}
        </div>
      )}

      {!isLoading && !isError && recommendations && (
        <StockRecommendationCard
          symbol={position.symbol}
          currentPrice={position.currentPrice}
          entryPrice={position.avgCost}
          gain={position.totalPnl}
          gainPercent={position.totalPnlPercent}
          selectedStyle={selectedStyle}
          selectedStyleName={STYLE_NAMES[selectedStyle]}
          allRecommendations={recommendations}
        />
      )}

      {!isLoading && !isError && !recommendations && (
        <div
          style={{
            padding: 16,
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          No recommendation data available
        </div>
      )}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────

export default function PortfolioDashboard({
  positions,
  totalValue,
  totalGain,
  totalReturn,
}: Props) {
  const { user } = useAuth();
  const { setTab } = useTabStore();
  const [showEmpty, setShowEmpty] = useState(false);
  const [dismissedConflict, setDismissedConflict] = useState(false);
  const stockDataMap = useRef<Record<string, Record<string, unknown>>>({});
  const [conflictVersion, setConflictVersion] = useState(0); // bump to recalc

  const handleDataLoaded = useCallback((symbol: string, data: Record<string, unknown>) => {
    stockDataMap.current[symbol] = data;
    setConflictVersion(v => v + 1);
  }, []);

  // Compute conflict from accumulated stock data
  // Short delay to prevent flash on fast loads
  React.useEffect(() => {
    const t = setTimeout(() => setShowEmpty(true), 300);
    return () => clearTimeout(t);
  }, []);

  if (!user) {
    return (
      <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text-dim)' }}>
        Please log in to view your portfolio dashboard.
      </div>
    );
  }

  const selectedStyle = (user.investorStyle || 'buffett') as InvestorStyle;
  const isPositive = totalReturn >= 0;

  // ── Conflict detection ─────────────────────────────────────
  const conflictAnalysis = useMemo<ConflictAnalysis>(() => {
    if (Object.keys(stockDataMap.current).length === 0) {
      return { hasConflict: false, severity: 'low', conflictMessage: '', metrics: {}, suggestions: [] };
    }
    return detectConflict(selectedStyle, positions, stockDataMap.current as any);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflictVersion, selectedStyle]);

  // Reset dismissal when conflict severity changes
  useEffect(() => {
    setDismissedConflict(false);
  }, [conflictAnalysis.severity]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Portfolio Overview ── */}
      <div
        style={{
          background: '#0f172a',
          border: '1px solid #1e293b',
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>📊 My Portfolio</h2>
          <span
            onClick={() => setTab('settings')}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--accent-teal)',
              cursor: 'pointer',
            }}
          >
            Change Style →
          </span>
        </div>

        {/* Metrics row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 2px' }}>
              Total Value
            </p>
            <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 2px' }}>
              Total Gain
            </p>
            <p
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isPositive ? '#22c55e' : '#ef4444',
                margin: 0,
              }}
            >
              {isPositive ? '+' : ''}${totalGain.toFixed(2)}
            </p>
          </div>
          <div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: '0 0 2px' }}>
              Total Return
            </p>
            <p
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: isPositive ? '#22c55e' : '#ef4444',
                margin: 0,
              }}
            >
              {isPositive ? '+' : ''}{totalReturn.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Style badge */}
        <div
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 24 }}>{STYLE_EMOJIS[selectedStyle]}</span>
          <div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)', margin: 0 }}>Advisor</p>
            <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
              {STYLE_NAMES[selectedStyle]}
            </p>
          </div>
        </div>
      </div>

      {/* ── Style Conflict Alert ── */}
      {!dismissedConflict && conflictAnalysis.hasConflict && (
        <ConflictAlert
          analysis={conflictAnalysis}
          onDismiss={() => setDismissedConflict(true)}
        />
      )}

      {/* ── Position Recommendations ── */}
      {positions.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--text-muted)',
              margin: 0,
              paddingLeft: 2,
            }}
          >
            Position Recommendations ({positions.length})
          </h3>
          {positions.map((pos) => (
            <PositionRow
              key={pos.symbol}
              position={pos}
              selectedStyle={selectedStyle}
              onDataLoaded={handleDataLoaded}
            />
          ))}
        </div>
      ) : showEmpty ? (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--text-dim)',
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 12,
          }}
        >
          No positions yet. Start trading to see recommendations.
        </div>
      ) : null}

      {/* ── Summary footer ── */}
      {positions.length > 0 && (
        <div
          style={{
            padding: 12,
            fontSize: 10,
            color: 'var(--text-dim)',
            textAlign: 'center',
          }}
        >
          Recommendations are AI-driven and for informational purposes only.
          Not financial advice.
        </div>
      )}
    </div>
  );
}
