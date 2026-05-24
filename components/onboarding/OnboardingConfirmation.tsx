'use client';

import React from 'react';
import { INVESTOR_STYLES } from './styles';
import type { InvestorStyle } from '@/types';

interface Props {
  selectedStyle: InvestorStyle;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
  error: string | null;
}

export function OnboardingConfirmation({
  selectedStyle,
  onConfirm,
  onBack,
  loading,
  error,
}: Props) {
  const style = INVESTOR_STYLES.find((s) => s.id === selectedStyle);

  if (!style) return null;

  return (
    <div>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #1e293b',
          textAlign: 'center',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Confirm Your Style
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          This will shape all your trading recommendations
        </p>
      </div>

      {/* Style card */}
      <div style={{ padding: 24 }}>
        <div
          style={{
            padding: 20,
            borderRadius: 12,
            border: '2px solid #06b6d4',
            background: 'rgba(6,182,212,0.06)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: 48, display: 'block', marginBottom: 8 }}>
            {style.emoji}
          </span>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{style.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {style.title}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              marginTop: 10,
              lineHeight: 1.6,
              maxWidth: 360,
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
          >
            {style.philosophy}
          </div>
        </div>

        {/* What you'll get */}
        <div
          style={{
            marginTop: 16,
            padding: 14,
            borderRadius: 10,
            background: '#1e293b',
            border: '1px solid #334155',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
            WITH THIS STYLE, YOU&apos;LL GET:
          </div>
          {style.id === 'buffett' && (
            <>
              <div style={itemStyle}>🔍 Deep value analysis on undervalued companies</div>
              <div style={itemStyle}>📊 Long-term hold recommendations (5-10+ years)</div>
              <div style={itemStyle}>💵 Dividend & cash flow screening</div>
              <div style={itemStyle}>🛡️ Conservative risk management</div>
            </>
          )}
          {style.id === 'lynch' && (
            <>
              <div style={itemStyle}>🚀 Growth stock screening (PEG ratio, revenue growth)</div>
              <div style={itemStyle}>📈 Mid-term hold recommendations (2-5 years)</div>
              <div style={itemStyle}>🔄 Rotation alerts when growth slows</div>
              <div style={itemStyle}>📊 Category-based stock analysis</div>
            </>
          )}
          {style.id === 'livermore' && (
            <>
              <div style={itemStyle}>⚡ Momementum & trend signals</div>
              <div style={itemStyle}>📉 Technical analysis (RSI, MACD, volume)</div>
              <div style={itemStyle}>🔄 Quick-entry/exit trade suggestions</div>
              <div style={itemStyle}>⚠️ Reversal & stop-loss alerts</div>
            </>
          )}
          {style.id === 'soros' && (
            <>
              <div style={itemStyle}>🌍 Macro event analysis (Fed, CPI, jobs)</div>
              <div style={itemStyle}>📊 Sector rotation & theme positioning</div>
              <div style={itemStyle}>💱 Currency & rate sensitivity screening</div>
              <div style={itemStyle}>🔮 Forward-looking regime predictions</div>
            </>
          )}
          {style.id === 'munger' && (
            <>
              <div style={itemStyle}>💰 Dividend growth & yield screening</div>
              <div style={itemStyle}>🏢 Quality business metrics (ROE, moat)</div>
              <div style={itemStyle}>📊 Ultra-long-term compounding analysis</div>
              <div style={itemStyle}>🛡️ Income stability & payout ratio checks</div>
            </>
          )}
        </div>

        {/* Warning banner */}
        <div
          style={{
            marginTop: 14,
            padding: 10,
            borderRadius: 8,
            background: 'rgba(6,182,212,0.08)',
            border: '1px solid rgba(6,182,212,0.2)',
            fontSize: 11,
            color: 'var(--accent-teal)',
            textAlign: 'center',
          }}
        >
          ℹ️ You can change this anytime from the Settings tab. This just sets your default.
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5',
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={onBack}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px 0',
              borderRadius: 10,
              background: 'transparent',
              border: '1px solid #475569',
              color: 'var(--text-dim)',
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            Back
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex: 2,
              padding: '12px 0',
              borderRadius: 10,
              background: '#22c55e',
              color: '#0f172a',
              border: 'none',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? 'Saving...' : 'Confirm & Start Trading'}
          </button>
        </div>
      </div>
    </div>
  );
}

const itemStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-dim)',
  padding: '4px 0',
  lineHeight: 1.4,
};
