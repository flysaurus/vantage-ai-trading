'use client';

import React, { useState } from 'react';
import { INVESTOR_STYLES } from './styles';
import type { InvestorStyle } from '@/types';

interface Props {
  onSelectStyle: (style: InvestorStyle) => void;
  error: string | null;
}

export function OnboardingStyleSelection({ onSelectStyle, error }: Props) {
  const [selected, setSelected] = useState<InvestorStyle>('buffett');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '85vh' }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
          Choose Your Investor Style
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Select the investment philosophy that resonates with you
        </p>
      </div>

      {/* Scrollable style cards */}
      <div style={{ padding: '12px 24px', overflowY: 'auto', flex: 1 }}>
        {INVESTOR_STYLES.map((s) => {
          const isActive = selected === s.id;

          return (
            <div
              key={s.id}
              onClick={() => setSelected(s.id)}
              style={{
                padding: 14,
                marginBottom: 8,
                borderRadius: 10,
                border: isActive ? '2px solid #06b6d4' : '2px solid #1e293b',
                background: isActive ? 'rgba(6,182,212,0.06)' : 'transparent',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              {/* Style header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 24, lineHeight: 1 }}>{s.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{s.title}</div>
                </div>
                {isActive && (
                  <span
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: '#06b6d4',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      color: '#0f172a',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    ✓
                  </span>
                )}
              </div>

              {/* Description */}
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                {s.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Selected style philosophy preview */}
      {(() => {
        const active = INVESTOR_STYLES.find((s) => s.id === selected);
        if (!active) return null;
        return (
          <div
            style={{
              margin: '0 24px',
              padding: 12,
              borderRadius: 8,
              background: 'rgba(6,182,212,0.08)',
              border: '1px solid rgba(6,182,212,0.2)',
              fontSize: 11,
              color: 'var(--accent-teal)',
              lineHeight: 1.5,
            }}
          >
            <strong>Philosophy:</strong> {active.philosophy}
          </div>
        );
      })()}

      {/* Error */}
      {error && (
        <div
          style={{
            margin: '8px 24px 0',
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

      {/* Footer */}
      <div
        style={{
          padding: '16px 24px',
          borderTop: '1px solid #1e293b',
        }}
      >
        <button
          onClick={() => onSelectStyle(selected)}
          style={{
            width: '100%',
            padding: '14px 0',
            borderRadius: 10,
            background: '#06b6d4',
            color: '#0f172a',
            border: 'none',
            fontSize: 15,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
