'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

// Minimal placeholder — will be replaced by Prompt 6 auth screens.
// Reads onboarding data from sessionStorage bridge.

export default function CreateAccountPage() {
  const router = useRouter();

  const data =
    typeof window !== 'undefined'
      ? (() => {
          try {
            const raw = sessionStorage.getItem('vantage_onboarding_data');
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 24px',
        gap: 'var(--space-6)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          textAlign: 'center',
        }}
      >
        Create Your Account
      </h1>

      {data ? (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            {data.firstName} {data.lastName}
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
            Style: {data.style} · Risk: {data.risk}
          </p>
        </div>
      ) : (
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', textAlign: 'center' }}>
          No onboarding data found. Please complete the quiz first.
        </p>
      )}

      <button
        onClick={() => router.push('/onboarding')}
        style={{
          padding: '10px 24px',
          borderRadius: 'var(--radius-button)',
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: 'var(--text-sm)',
          fontFamily: 'inherit',
        }}
      >
        ← Back to Onboarding
      </button>
    </div>
  );
}
