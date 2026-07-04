// ─── DemoCounterPage ────────────────────────────────────────
// Shown in two contexts:
//  1. First-time: inside /welcome after "YOU'RE IN." (isFirstTime=true)
//  2. Returning: when AppState = 'demo-counter' on login (isFirstTime=false)
//
// Displays days remaining in demo, upgrade prompt, and enter-app CTA.
// Fetches demo_expires_at from /api/connections/status if prop is null.

'use client';

import React, { useState, useEffect } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { UserProfile } from '@/lib/app-state';

// ── Props ───────────────────────────────────────────────────

interface DemoCounterPageProps {
  // New prompt-6 pattern
  isFirstTime?: boolean;
  onContinue?: () => void;
  demoExpiresAt?: string | null;
  onConnectBroker?: () => void;
  // Legacy support (used by app/page.tsx state='demo-counter')
  profile?: UserProfile | null;
  onEnter?: () => void;
}

// ── Sub-components ──────────────────────────────────────────

function Spinner() {
  return (
    <div
      style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        border: '2.5px solid rgba(255,255,255,0.15)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.6s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

// ── Main ────────────────────────────────────────────────────

export default function DemoCounterPage({
  isFirstTime = false,
  onContinue,
  demoExpiresAt: demoExpiresAtProp,
  onConnectBroker,
  profile,
  onEnter,
}: DemoCounterPageProps) {
  // Resolve: prop takes priority, then profile.demoExpiresAt (legacy), then null
  const resolvedExpiresAt = demoExpiresAtProp ?? profile?.demo_expires_at ?? null;
  const [expiresAt, setExpiresAt] = useState<string | null>(resolvedExpiresAt);
  const [loading, setLoading] = useState(!resolvedExpiresAt);
  const [fetchError, setFetchError] = useState('');

  // Fetch demo_expires_at if not provided
  useEffect(() => {
    if (resolvedExpiresAt) return;

    let cancelled = false;

    async function fetchStatus() {
      try {
        const res = await fetch('/api/connections/status', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (!cancelled) {
          setExpiresAt(data.demo_expires_at ?? null);
        }
      } catch {
        if (!cancelled) {
          setFetchError('Something went wrong. Please refresh.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [demoExpiresAtProp]);

  // ── Derived ───────────────────────────────────────────────

  const daysRemaining = (() => {
    if (!demoStartAtProp && !expiresAt) return 0;
    const start = demoStartAtProp ? new Date(demoStartAtProp) : null;
    const expires = expiresAt ? new Date(expiresAt) : null;
    if (!expires) return 0;

    const dateOnly = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const startDate = start ? dateOnly(start) : dateOnly(new Date());
    const todayDate = dateOnly(new Date());
    const expiresDate = dateOnly(expires);

    const DAY_MS = 86400000;
    const totalDays = Math.round((expiresDate.getTime() - startDate.getTime()) / DAY_MS);
    const daysSinceStart = Math.round((todayDate.getTime() - startDate.getTime()) / DAY_MS);

    return Math.max(0, totalDays - daysSinceStart);
  })();

  const eyebrowText = isFirstTime ? 'DEMO ACTIVATED' : 'WELCOME BACK';

  const subtext = isFirstTime
    ? "Your $100,000 virtual portfolio is ready. Let's put it to work."
    : "You're trading with $100,000 of virtual money.";

  const enterButtonText = isFirstTime
    ? 'Start trading \u2192'
    : 'Enter Vantage \u2192';

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          background: 'var(--bg)',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <Spinner />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────

  if (fetchError) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100dvh',
          background: 'var(--bg)',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
          padding: '24px',
          gap: '16px',
        }}
      >
        <p
          style={{
            fontSize: '15px',
            color: 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: 0,
          }}
        >
          {fetchError}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'none',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '999px',
            padding: '10px 24px',
            color: 'var(--accent)',
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Refresh
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: '#fff',
        fontFamily: 'var(--font-sans)',
        alignItems: 'center',
        padding: '12px 16px 16px',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '36px',
        }}
      >
        <VantageOrb size={32} animate />
      </div>

      {/* ═══ EYEBROW ═══ */}
      <p
        style={{
          margin: '10px 0 6px',
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--accent)',
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {eyebrowText}
      </p>

      {/* ═══ HEADLINE ═══ */}
      <h1
        style={{
          margin: '0 0 12px',
          textAlign: 'center',
          lineHeight: 1.15,
          fontSize: '36px',
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            color: '#ffffff',
          }}
        >
          {daysRemaining === 1
            ? 'You have 1 day'
            : `You have ${daysRemaining} days`}
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#ffffff',
          }}
        >
          left in demo.
        </span>
      </h1>

      {/* ═══ SUBTEXT ═══ */}
      <p
        style={{
          fontSize: '14px',
          fontWeight: 400,
          color: 'rgba(255,255,255,0.60)',
          textAlign: 'center',
          margin: '0 0 10px',
          lineHeight: 1.5,
          maxWidth: '340px',
        }}
      >
        {subtext}
      </p>

      {/* ═══ UPGRADE CARD ═══ */}
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          borderRadius: '16px',
          border: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(255,255,255,0.03)',
          padding: '14px',
          marginBottom: '12px',
        }}
      >
        <div
          style={{
            fontSize: '15px',
            fontWeight: 700,
            marginBottom: '4px',
          }}
        >
          Want to use real money?
        </div>
        <p
          style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.60)',
            margin: '0 0 12px',
            lineHeight: 1.4,
          }}
        >
          Connect your broker to get AI analysis of your actual
          portfolio.
        </p>
        <button
          onClick={onConnectBroker}
          style={{
            width: '100%',
            height: '48px',
            borderRadius: '999px',
            border: 'none',
            background: 'var(--accent)',
            color: '#000',
            fontSize: '15px',
            fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
        >
          Connect a broker &rarr;
        </button>
      </div>

      {/* ═══ PLANS LINK (secondary) ═══ */}
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = '/plans';
        }}
        style={{
          background: 'none',
          border: 'none',
          color: '#22d3ee',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)',
          margin: '0 auto 10px',
          display: 'block',
          padding: 0,
        }}
      >
        See what&rsquo;s included with Vantage Silver &amp; Gold &rarr;
      </button>

      {/* ═══ SETTINGS NOTE ═══ */}
      <p
        style={{
          margin: '0 0 16px',
          fontSize: '11px',
          fontWeight: 400,
          color: 'rgba(255,255,255,0.40)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          lineHeight: 1.5,
        }}
      >
        You can also do this anytime from Settings.
      </p>

      {/* ═══ ENTER APP BUTTON ═══ */}
      <button
        onClick={onEnter || onContinue}
        style={{
          width: '100%',
          maxWidth: '380px',
          height: '48px',
          borderRadius: '999px',
          border: 'none',
          background: '#ffffff',
          color: '#000000',
          fontSize: '16px',
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          transition: 'opacity 0.2s',
        }}
      >
        {enterButtonText}
      </button>

      {/* Spin keyframes */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// Named export for existing consumers
export { DemoCounterPage };
