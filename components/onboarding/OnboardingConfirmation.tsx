'use client';

import React from 'react';
import { INVESTOR_STYLES } from './styles';
import type { InvestorStyle } from '@/types';

interface Props {
  selectedStyle: InvestorStyle;
  onConfirm: () => void;
  onBack: () => void;
  loading: boolean;
  error?: string | null;
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
    <div style={{ padding: 28 }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <span style={{ fontSize: 48, display: 'block', marginBottom: 12 }}>
          {style.emoji}
        </span>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>
          {style.name}
        </h2>
        <p style={{ fontSize: 14, color: 'var(--accent-teal)', margin: 0 }}>
          {style.title}
        </p>
      </div>

      {/* Philosophy + Means */}
      <div
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: 16,
          marginBottom: 14,
        }}
      >
        <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '0 0 14px', lineHeight: 1.5 }}>
          {style.philosophy}
        </p>

        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', margin: '0 0 8px' }}>
            This means:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {style.means.map((item: string, idx: number) => (
              <div
                key={idx}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
              >
                <span style={{ color: '#22c55e', fontSize: 12, lineHeight: 1.4, flexShrink: 0 }}>
                  ✓
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
                  {item}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Info banner */}
      <div
        style={{
          padding: 10,
          borderRadius: 8,
          background: 'rgba(6,182,212,0.08)',
          border: '1px solid rgba(6,182,212,0.2)',
          fontSize: 11,
          color: 'var(--accent-teal)',
          marginBottom: 14,
          textAlign: 'center',
        }}
      >
        💡 <strong>All recommendations</strong> will be personalized through this investment philosophy.
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5',
            fontSize: 12,
            marginBottom: 14,
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
  );
}
