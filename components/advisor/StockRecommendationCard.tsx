'use client';

import React, { useState } from 'react';
import type { InvestorStyle } from '@/types';

// ─── Types ────────────────────────────────────────────────────

export interface StyleRecommendation {
  recommendation: 'BUY_MORE' | 'HOLD' | 'SELL';
  confidence: number; // 0-1
  reasoning: string;
  keyFactors?: string[];
  risks?: string[];
}

export type AllStylesRecommendations = Record<InvestorStyle, StyleRecommendation>;

interface Props {
  symbol: string;
  currentPrice: number;
  entryPrice: number;
  gain: number;
  gainPercent: number;
  selectedStyle: InvestorStyle;
  selectedStyleName: string;
  allRecommendations: AllStylesRecommendations;
}

// ─── Constants ────────────────────────────────────────────────

const STYLE_COLORS: Record<InvestorStyle, { bg: string; border: string; text: string }> = {
  buffett: { bg: '#4c1d95', border: '#7c3aed', text: '#c4b5fd' },
  lynch: { bg: '#064e3b', border: '#059669', text: '#6ee7b7' },
  livermore: { bg: '#713f12', border: '#ca8a04', text: '#fde047' },
  soros: { bg: '#7f1d1d', border: '#dc2626', text: '#fca5a5' },
  munger: { bg: '#1e3a5f', border: '#2563eb', text: '#93c5fd' },
};

const STYLE_EMOJIS: Record<InvestorStyle, string> = {
  buffett: '💎',
  lynch: '📈',
  livermore: '⚡️',
  soros: '🌍',
  munger: '💰',
};

const STYLE_NAMES: Record<InvestorStyle, string> = {
  buffett: 'Warren Buffett',
  lynch: 'Peter Lynch',
  livermore: 'Jesse Livermore',
  soros: 'George Soros',
  munger: 'Charlie Munger',
};

const REC_CSS: Record<string, { bg: string; color: string }> = {
  BUY_MORE: { bg: '#166534', color: '#bbf7d0' },
  HOLD: { bg: '#713f12', color: '#fde68a' },
  SELL: { bg: '#7f1d1d', color: '#fecaca' },
};

// ─── Helpers ──────────────────────────────────────────────────

function getRecLabel(rec: string): string {
  if (rec === 'BUY_MORE') return 'BUY MORE';
  return rec;
}

// ─── Component ────────────────────────────────────────────────

export function StockRecommendationCard({
  symbol,
  currentPrice,
  entryPrice,
  gain,
  gainPercent,
  selectedStyle,
  allRecommendations,
}: Props) {
  const [showAllStyles, setShowAllStyles] = useState(false);
  const selectedRec = allRecommendations[selectedStyle];
  const colors = STYLE_COLORS[selectedStyle];
  const isPositive = gainPercent >= 0;

  return (
    <div
      style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      {/* ── Header: Price Info ── */}
      <div
        style={{
          padding: 14,
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            {symbol}
          </h3>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
            Entry: ${entryPrice.toFixed(2)} · Current: ${currentPrice.toFixed(2)}
          </p>
        </div>
        <div style={{ color: isPositive ? '#22c55e' : '#ef4444', textAlign: 'right' }}>
          <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
            {isPositive ? '+' : ''}{gainPercent.toFixed(2)}%
          </p>
          <p style={{ fontSize: 10, margin: '2px 0 0' }}>
            {isPositive ? '+' : ''}${gain.toFixed(2)}
          </p>
        </div>
      </div>

      {/* ── Selected Style Recommendation ── */}
      <div style={{ padding: 16, background: colors.bg }}>
        {/* Style label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>{STYLE_EMOJIS[selectedStyle]}</span>
          <div>
            <p style={{ fontSize: 10, color: colors.text, margin: 0, opacity: 0.7 }}>
              Your Selected Style
            </p>
            <p style={{ fontSize: 13, fontWeight: 600, color: colors.text, margin: 0 }}>
              {STYLE_NAMES[selectedStyle]}
            </p>
          </div>
        </div>

        {/* Recommendation badge + confidence */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 700,
              background: REC_CSS[selectedRec.recommendation].bg,
              color: REC_CSS[selectedRec.recommendation].color,
            }}
          >
            {getRecLabel(selectedRec.recommendation)}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.text }}>
            {Math.round(selectedRec.confidence * 100)}% confidence
          </span>
        </div>

        {/* Confidence bar */}
        <div
          style={{
            height: 4,
            borderRadius: 2,
            background: 'rgba(255,255,255,0.1)',
            marginBottom: 10,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.round(selectedRec.confidence * 100)}%`,
              borderRadius: 2,
              background: colors.border,
              transition: 'width 0.3s',
            }}
          />
        </div>

        {/* Why? */}
        <p style={{ fontSize: 11, fontWeight: 600, color: colors.text, margin: '0 0 4px' }}>
          Why?
        </p>
        <p style={{ fontSize: 12, color: colors.text, margin: '0 0 10px', lineHeight: 1.5 }}>
          {selectedRec.reasoning}
        </p>

        {/* Key factors + risks */}
        <div style={{ display: 'flex', gap: 10, flexDirection: 'column' }}>
          {selectedRec.keyFactors && selectedRec.keyFactors.length > 0 && (
            <div>
              {selectedRec.keyFactors.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: colors.text, opacity: 0.9, marginBottom: 2 }}>
                  <span style={{ color: '#22c55e', flexShrink: 0 }}>✓</span> <span>{f}</span>
                </div>
              ))}
            </div>
          )}
          {selectedRec.risks && selectedRec.risks.length > 0 && (
            <div>
              {selectedRec.risks.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, color: colors.text, opacity: 0.9, marginBottom: 2 }}>
                  <span style={{ color: '#facc15', flexShrink: 0 }}>⚠️</span> <span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── View All 5 Styles Toggle ── */}
      <div style={{ borderTop: '1px solid #1e293b' }}>
        <button
          onClick={() => setShowAllStyles(!showAllStyles)}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {showAllStyles ? '✕ Hide' : '→ View'} what other advisors say
        </button>

        {showAllStyles && (
          <div style={{ padding: '14px', background: 'rgba(30,41,59,0.5)' }}>
            {(Object.keys(allRecommendations) as InvestorStyle[]).map((style) => {
              const rec = allRecommendations[style];
              const c = STYLE_COLORS[style];
              const isCurrent = style === selectedStyle;

              return (
                <div
                  key={style}
                  style={{
                    padding: 10,
                    marginBottom: 6,
                    borderRadius: 8,
                    background: isCurrent ? c.bg : '#1e293b',
                    border: isCurrent ? `1px solid ${c.border}` : '1px solid #334155',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{STYLE_EMOJIS[style]}</span>
                      <div>
                        {isCurrent && (
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block' }}>
                            (Your style)
                          </span>
                        )}
                        <span style={{ fontSize: 12, fontWeight: 600 }}>
                          {STYLE_NAMES[style]}
                        </span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background: REC_CSS[rec.recommendation].bg,
                          color: REC_CSS[rec.recommendation].color,
                        }}
                      >
                        {getRecLabel(rec.recommendation)}
                      </span>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        {Math.round(rec.confidence * 100)}%
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0, lineHeight: 1.4 }}>
                    {rec.reasoning.length > 100
                      ? rec.reasoning.slice(0, 100) + '...'
                      : rec.reasoning}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
