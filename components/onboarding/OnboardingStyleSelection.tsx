'use client';

import React, { useState } from 'react';
import { INVESTOR_STYLES } from './styles';
import type { InvestorStyle } from '@/types';

interface Props {
  onSelectStyle: (style: InvestorStyle) => void;
  error?: string | null;
}

export function OnboardingStyleSelection({ onSelectStyle, error }: Props) {
  const [hoveredStyle, setHoveredStyle] = useState<InvestorStyle | null>(null);

  return (
    <div style={{ padding: 28 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>
          Which describes you best?
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Your choice will personalize all recommendations
        </p>
      </div>

      {/* Style Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {INVESTOR_STYLES.map((style) => {
          const isHovered = hoveredStyle === style.id;

          return (
            <button
              key={style.id}
              onClick={() => onSelectStyle(style.id)}
              onMouseEnter={() => setHoveredStyle(style.id)}
              onMouseLeave={() => setHoveredStyle(null)}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: 14,
                borderRadius: 10,
                border: isHovered ? '2px solid #06b6d4' : '2px solid #1e293b',
                background: isHovered ? 'rgba(6,182,212,0.06)' : '#0f172a',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Emoji */}
                <span style={{ fontSize: 32, lineHeight: 1, flexShrink: 0 }}>
                  {style.emoji}
                </span>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>
                      {style.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--accent-teal)',
                        marginLeft: 8,
                      }}
                    >
                      {style.title}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: '4px 0 0', lineHeight: 1.4 }}>
                    {style.description}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                    Time horizon: {style.timeHorizon}
                  </p>
                </div>

                {/* Arrow */}
                <span
                  style={{
                    fontSize: 18,
                    color: isHovered ? '#06b6d4' : '#475569',
                    flexShrink: 0,
                    alignSelf: 'center',
                    transition: 'color 0.15s',
                  }}
                >
                  →
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5',
            fontSize: 12,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* Default CTA */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
          Can&apos;t decide? Select Warren Buffett — it&apos;s a safe default
        </p>
        <button
          onClick={() => onSelectStyle('buffett')}
          style={{
            background: 'none',
            border: 'none',
            color: '#06b6d4',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          [Use Buffett as default]
        </button>
      </div>
    </div>
  );
}
