'use client';

import React, { useEffect } from 'react';

interface StrategySheetProps {
  strategy: string | null;
  onClose: () => void;
  onExecute: () => void;
}

interface StrategyContent {
  icon: string;
  label: string;
  bestFor: string;
  what: string;
  when: string[];
  risks: string[];
}

const STRATEGIES: Record<string, StrategyContent> = {
  dca: {
    icon: '🔄',
    label: 'Dollar Cost Averaging',
    bestFor: 'Long-term investors',
    what: 'Invest a fixed amount on a schedule regardless of price. Removes emotional timing decisions and reduces average cost over time.',
    when: [
      'You invest regularly from income',
      'You believe in an asset long-term',
      'You want to build a position gradually',
    ],
    risks: [
      'Still lose money if asset declines long-term',
      'Requires discipline during downturns',
    ],
  },
  rebalance: {
    icon: '⚖️',
    label: 'Portfolio Rebalancing',
    bestFor: 'Diversified portfolios',
    what: 'Restore your portfolio to target allocations by selling what grew too large and buying what fell behind. Keeps your risk level consistent.',
    when: [
      'Allocation drifted 5%+ from target',
      'After a big market move',
      'Annually as routine maintenance',
    ],
    risks: [
      'May trigger capital gains taxes',
      'Could sell winners too early',
    ],
  },
  momentum: {
    icon: '🚀',
    label: 'Momentum',
    bestFor: 'Active traders',
    what: 'Buy stocks rising strongly over 3-12 months, sell those falling. Based on the principle that trends persist longer than expected.',
    when: [
      'Market is in a clear uptrend',
      'You can monitor positions regularly',
      'You accept higher turnover',
    ],
    risks: [
      'Sharp reversals cause quick losses',
      'Higher frequency means more taxes and fees',
    ],
  },
  meanreversion: {
    icon: '📉',
    label: 'Mean Reversion',
    bestFor: 'Range-bound markets',
    what: 'Buy stocks that fell significantly below their historical average expecting a snapback. Sell stocks unusually extended above their average.',
    when: [
      'Stock dropped 15-20%+ without fundamental reason',
      'RSI below 30',
      'Sideways market conditions',
    ],
    risks: [
      'Catching a falling knife if decline continues',
      'Reversion can take weeks or months',
    ],
  },
  taxharvest: {
    icon: '🧾',
    label: 'Tax-Loss Harvesting',
    bestFor: 'Taxable accounts',
    what: 'Sell losing positions to realize losses that offset gains elsewhere, reducing your tax bill. Replace with similar assets to maintain exposure.',
    when: [
      'You have capital gains to offset',
      'October–December timeframe',
      'Position is down 10%+ with no catalyst',
    ],
    risks: [
      "Wash sale rule — can't rebuy same stock within 30 days",
      'May disrupt long-term strategy',
    ],
  },
};

export default function StrategySheet({ strategy, onClose, onExecute }: StrategySheetProps) {
  // Lock body scroll when sheet is open
  useEffect(() => {
    if (strategy) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [strategy]);

  if (!strategy) return null;

  const content = STRATEGIES[strategy];
  if (!content) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 50,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(2px)',
          animation: 'strategyFadeIn 0.2s ease-out',
        }}
      />

      {/* Sheet */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          height: '80vh',
          background: '#0f172a',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          display: 'flex',
          flexDirection: 'column',
          animation: 'strategySlideUp 0.3s ease-out',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ─── Header (non-scrolling) ────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px 8px',
            borderBottom: '1px solid #1e293b',
            flexShrink: 0,
            position: 'relative',
          }}
        >
          {/* Drag Handle */}
          <div
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 36,
              height: 4,
              borderRadius: 2,
              background: '#475569',
            }}
          />
          {/* Icon + Name */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <span style={{ fontSize: 26 }}>{content.icon}</span>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
                {content.label}
              </h3>
              <span
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  fontWeight: 600,
                  color: '#06b6d4',
                  background: 'rgba(6,182,212,0.1)',
                  border: '1px solid rgba(6,182,212,0.25)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  marginTop: 4,
                }}
              >
                Best for: {content.bestFor}
              </span>
            </div>
          </div>
          {/* X Close */}
          <button
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#94a3b8',
              fontSize: 16,
              cursor: 'pointer',
              fontFamily: 'inherit',
              flexShrink: 0,
              marginLeft: 8,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* ─── Content (scrollable) ──────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '16px 16px 24px',
          }}
        >
          {/* What is it? */}
          <div
            style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: 14,
              marginBottom: 10,
              border: '1px solid #334155',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#06b6d4',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              💡 What is it?
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
              {content.what}
            </p>
          </div>

          {/* When to use */}
          <div
            style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: 14,
              marginBottom: 10,
              border: '1px solid #334155',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#06b6d4',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              📋 When to use
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {content.when.map((b, i) => (
                <li key={i} style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 4 }}>
                  {b}
                </li>
              ))}
            </ul>
          </div>

          {/* Risks */}
          <div
            style={{
              background: '#1e293b',
              borderRadius: 10,
              padding: 14,
              marginBottom: 10,
              border: '1px solid #334155',
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: '#06b6d4',
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              ⚠️ Risks
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {content.risks.map((b, i) => (
                <li key={i} style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, marginBottom: 4 }}>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ─── Execute Button (non-scrolling) ────────────── */}
        <div
          style={{
            flexShrink: 0,
            padding: '12px 16px 80px',
            borderTop: '1px solid #1e293b',
            background: '#0f172a',
          }}
        >
          <button
            onClick={onExecute}
            style={{
              width: '100%',
              padding: 14,
              border: 'none',
              borderRadius: 10,
              background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
              color: 'white',
              fontSize: 15,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: 'inherit',
            }}
          >
            Execute →
          </button>
        </div>
      </div>

      {/* Keyframes */}
      <style jsx>{`
        @keyframes strategyFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes strategySlideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
