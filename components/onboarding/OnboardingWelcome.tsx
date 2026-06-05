'use client';

import React from 'react';
import CompassIcon from '../CompassIcon';

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export function OnboardingWelcome({ onNext, onSkip }: Props) {
  return (
    <div style={{ padding: 32 }}>
      {/* Icon */}
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ marginBottom: 12 }}><CompassIcon size={48} color="#22d3ee" /></div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
          Welcome to Vantage
        </h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
          Institutional-quality AI portfolio analysis. Built for everyone.
          Before we dive in, let's set up your investment style so every
          recommendation is tailored to you.
        </p>
      </div>

      {/* Why this matters */}
      <div
        style={{
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 10,
          padding: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>
          WHY THIS MATTERS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Portfolio analysis filtered through your philosophy
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Stock recommendations that match your approach
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Rebalancing suggestions aligned with your goals
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: '#22c55e', fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              You can always change this later in Settings
            </span>
          </div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onNext}
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
        Choose Your Style →
      </button>

      {/* Skip */}
      <div style={{ textAlign: 'center', marginTop: 14 }}>
        <button
          onClick={onSkip}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: 12,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Skip — I'll set this up later in Settings
        </button>
      </div>
    </div>
  );
}
