// ─── ResultScreen ──────────────────────────────────────────
// Final screen of the onboarding quiz.
//
// Layout:
// - "You're a [STYLE] Investor" (large heading)
// - Style description (2-3 lines)
// - Risk badge: "Risk Profile: Moderate"
// - Starting investor score: 0
// - Override option: horizontal scroll of style pills
// - "Enter Vantage →" CTA (full width, cyan)
//
// On Enter Vantage: saves style, name, risk to localStorage;
// syncs to Supabase; marks quiz complete; navigates to /

'use client';

import React, { useState, useEffect } from 'react';
import type { InvestorStyle } from '@/types';
import { getStyleDescription, getStyleDisplayName } from '@/lib/onboarding/quiz-logic';
import type { QuizResult } from '@/lib/onboarding/quiz-logic';

const ALL_STYLES: { id: InvestorStyle; emoji: string; name: string }[] = [
  { id: 'buffett', emoji: '💎', name: 'Buffett' },
  { id: 'lynch', emoji: '📈', name: 'Lynch' },
  { id: 'livermore', emoji: '⚡', name: 'Livermore' },
  { id: 'munger', emoji: '💰', name: 'Munger' },
  { id: 'soros', emoji: '🌍', name: 'Soros' },
];

interface ResultScreenProps {
  result: QuizResult;
  userName: string;
  onEnter: (style: InvestorStyle, riskTolerance: string) => void;
}

export function ResultScreen({ result, userName, onEnter }: ResultScreenProps) {
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyle>(result.style);
  const [visible, setVisible] = useState(false);

  // Preload localStorage values if they exist
  useEffect(() => {
    try {
      const savedName = localStorage.getItem('vantage_user_name');
      if (savedName) {
        // Name already exists, use it
      }
    } catch {}

    const t = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      style={{
        padding: '0 20px 32px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(20px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
      }}
    >
      {/* Result badge */}
      <div style={{ marginBottom: '24px', marginTop: '20px' }}>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 16px',
            background: 'rgba(34, 211, 238, 0.10)',
            border: '1px solid rgba(34, 211, 238, 0.25)',
            borderRadius: '20px',
            fontSize: '13px',
            fontWeight: 600,
            color: '#22d3ee',
          }}
        >
          Your Investor Profile
        </div>
      </div>

      {/* Style emoji */}
      <div style={{ fontSize: '56px', marginBottom: '12px' }}>
        {ALL_STYLES.find(s => s.id === selectedStyle)?.emoji || '💎'}
      </div>

      {/* Heading */}
      <h1
        style={{
          fontSize: '28px',
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          marginBottom: '12px',
          lineHeight: 1.3,
        }}
      >
        You&apos;re a{' '}
        <span style={{ color: '#22d3ee' }}>{getStyleDisplayName(selectedStyle)}</span>{' '}
        Investor
      </h1>

      {/* Style description */}
      <p
        style={{
          fontSize: '14px',
          color: '#94a3b8',
          textAlign: 'center',
          lineHeight: 1.6,
          maxWidth: '320px',
          marginBottom: '20px',
        }}
      >
        {getStyleDescription(selectedStyle)}
      </p>

      {/* Risk badge */}
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          background: result.riskTolerance === 'Aggressive'
            ? 'rgba(239, 68, 68, 0.10)'
            : result.riskTolerance === 'Conservative'
              ? 'rgba(34, 211, 238, 0.08)'
              : 'rgba(251, 191, 36, 0.10)',
          border: `1px solid ${
            result.riskTolerance === 'Aggressive'
              ? 'rgba(239, 68, 68, 0.25)'
              : result.riskTolerance === 'Conservative'
                ? 'rgba(34, 211, 238, 0.20)'
                : 'rgba(251, 191, 36, 0.20)'
          }`,
          borderRadius: '12px',
          marginBottom: '24px',
          fontSize: '13px',
          fontWeight: 500,
          color: result.riskTolerance === 'Aggressive'
            ? '#fca5a5'
            : result.riskTolerance === 'Conservative'
              ? '#67e8f9'
              : '#fbbf24',
        }}
      >
        <span>Risk Profile:</span>
        <span style={{ fontWeight: 600 }}>{result.riskTolerance}</span>
      </div>

      {/* Score card */}
      <div
        style={{
          width: '100%',
          maxWidth: '320px',
          padding: '16px',
          background: '#1a2235',
          border: '1px solid #1e293b',
          borderRadius: '14px',
          marginBottom: '24px',
          textAlign: 'center',
        }}
      >
        <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
          Starting Investor Score
        </p>
        <p style={{ fontSize: '32px', fontWeight: 700, color: '#22d3ee' }}>0</p>
        <p style={{ fontSize: '12px', color: '#475569', marginTop: '4px' }}>
          Check back in 7 days
        </p>
      </div>

      {/* Style override */}
      <div style={{ width: '100%', marginBottom: '20px' }}>
        <p
          style={{
            fontSize: '13px',
            color: '#64748b',
            textAlign: 'center',
            marginBottom: '10px',
          }}
        >
          Not quite right? Choose your style:
        </p>

        <div
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            padding: '0 0 4px',
            justifyContent: 'center',
            // Hide scrollbar
            scrollbarWidth: 'none',
          }}
        >
          {ALL_STYLES.map((s) => {
            const isActive = selectedStyle === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedStyle(s.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 14px',
                  background: isActive ? 'rgba(34, 211, 238, 0.12)' : '#1a2235',
                  border: isActive ? '1px solid #22d3ee' : '1px solid #1e293b',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  flexShrink: 0,
                  minWidth: '60px',
                }}
              >
                <span style={{ fontSize: '20px' }}>{s.emoji}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: isActive ? '#22d3ee' : '#64748b',
                  }}
                >
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Enter Vantage CTA */}
      <button
        onClick={() => onEnter(selectedStyle, result.riskTolerance)}
        style={{
          width: '100%',
          maxWidth: '320px',
          padding: '16px 0',
          background: '#22d3ee',
          border: 'none',
          borderRadius: '14px',
          fontSize: '16px',
          fontWeight: 700,
          color: '#0a0f1e',
          cursor: 'pointer',
          transition: 'transform 0.15s ease',
        }}
        onMouseDown={(e) => {
          e.currentTarget.style.transform = 'scale(0.97)';
        }}
        onMouseUp={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
        }}
      >
        Enter Vantage →
      </button>

      {/* Greeting preview */}
      <p
        style={{
          fontSize: '12px',
          color: '#475569',
          marginTop: '16px',
          textAlign: 'center',
        }}
      >
        {userName ? `See you inside, ${userName}!` : 'See you inside!'}
      </p>
    </div>
  );
}
