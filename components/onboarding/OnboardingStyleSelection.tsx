'use client';

import React, { useState } from 'react';
import { INVESTOR_STYLES } from './styles';
import type { InvestorStyle } from '@/types';

interface Props {
  selectedStyle: InvestorStyle | null;
  onSelectStyle: (style: InvestorStyle) => void;
  onAccept: () => void;
  loading: boolean;
  error?: string | null;
}

export function OnboardingStyleSelection({
  selectedStyle,
  onSelectStyle,
  onAccept,
  loading,
  error,
}: Props) {
  const [hoveredStyle, setHoveredStyle] = useState<InvestorStyle | null>(null);

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px' }}>
          Choose Your Investor Persona
        </h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          Pick the legend whose philosophy resonates with you. This will personalize all recommendations.
        </p>
      </div>

      {/* Style Cards — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, minHeight: 0 }}>
        {INVESTOR_STYLES.map((style) => {
          const isSelected = selectedStyle === style.id;
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
                border: isSelected
                  ? '2px solid #06b6d4'
                  : isHovered
                    ? '2px solid #475569'
                    : '2px solid #1e293b',
                background: isSelected
                  ? 'rgba(6,182,212,0.08)'
                  : isHovered
                    ? 'rgba(30,41,59,0.6)'
                    : '#0f172a',
                cursor: 'pointer',
                transition: 'border-color 0.15s, background 0.15s',
                fontFamily: 'inherit',
                position: 'relative',
              }}
            >
              {/* Selected checkmark */}
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 10, right: 10,
                  width: 22, height: 22, borderRadius: '50%',
                  background: '#06b6d4', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <span style={{ color: '#0f172a', fontSize: 12, fontWeight: 700 }}>✓</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingRight: isSelected ? 28 : 0 }}>
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
                        color: isSelected ? '#06b6d4' : 'var(--text-muted)',
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
              </div>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: 12, marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Accept Button */}
      <button
        onClick={onAccept}
        disabled={loading}
        style={{
          width: '100%',
          padding: '14px 0',
          borderRadius: 10,
          border: 'none',
          background: selectedStyle
            ? 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)'
            : '#1e293b',
          color: selectedStyle ? '#0f172a' : '#475569',
          fontSize: 15,
          fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer',
          transition: 'opacity 0.15s',
          opacity: loading ? 0.7 : 1,
          marginBottom: 8,
        }}
      >
        {loading
          ? 'Saving...'
          : selectedStyle
            ? `Accept ${INVESTOR_STYLES.find(s => s.id === selectedStyle)?.name || 'Style'}`
            : 'Pick a style to continue'}
      </button>

      {/* Skip / Can't decide */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
          Can&apos;t decide? You can change your style anytime.
        </p>
        <button
          onClick={() => {
            onSelectStyle('buffett');
            // Auto-accept after a brief highlight
            setTimeout(onAccept, 100);
          }}
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
          Start with Warren Buffett
        </button>
      </div>
    </div>
  );
}
