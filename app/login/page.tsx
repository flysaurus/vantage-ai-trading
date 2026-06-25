'use client';

import React from 'react';
import { useRouter } from 'next/navigation';

// Minimal login page — will be rebuilt in Prompt 6.
// For now, renders a placeholder that routes to the real
// login flow (magic link / OAuth / Supabase auth).

export default function LoginPage() {
  const router = useRouter();

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
        minHeight: '100dvh',
        padding: 'env(safe-area-inset-top) env(safe-area-inset-bottom) 0',
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <h1
          style={{
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            marginBottom: 'var(--space-6)',
          }}
        >
          Sign In
        </h1>
        <p
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-4)',
          }}
        >
          Your full login experience will be available here soon — stay tuned for
          the complete Vantage Auth Rebuild.
        </p>
      </div>
    </div>
  );
}
