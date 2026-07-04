// ─── DemoCounterPage ────────────────────────────────────────
// Shown in two contexts:
//  1. First-time: inside /welcome after "YOU'RE IN." (isFirstTime=true)
//  2. Returning: when AppState = 'demo-counter' on login (isFirstTime=false)
//
// Displays days remaining in demo, a grouped demo-actions section,
// and a distinct upgrade-to-plans section.

'use client';

import React, { useState, useEffect } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { UserProfile } from '@/lib/app-state';
import { estDateOnly } from '@/lib/demo-utils';

// ── Props ───────────────────────────────────────────────────

interface DemoCounterPageProps {
  isFirstTime?: boolean;
  onContinue?: () => void;
  demoExpiresAt?: string | null;
  onConnectBroker?: () => void;
  profile?: UserProfile | null;
  onEnter?: () => void;
}

// ── Sub-components ──────────────────────────────────────────

function Spinner() {
  return (
    <div
      style={{
        width: '24px', height: '24px', borderRadius: '50%',
        border: '2.5px solid rgba(255,255,255,0.15)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.6s linear infinite', flexShrink: 0,
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
  const resolvedExpiresAt = demoExpiresAtProp ?? profile?.demo_expires_at ?? null;
  const [expiresAt, setExpiresAt] = useState<string | null>(resolvedExpiresAt);
  const [loading, setLoading] = useState(!resolvedExpiresAt);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    if (resolvedExpiresAt) return;
    let cancelled = false;
    async function fetchStatus() {
      try {
        const res = await fetch('/api/connections/status', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        if (!cancelled) setExpiresAt(data.demo_expires_at ?? null);
      } catch {
        if (!cancelled) setFetchError('Something went wrong. Please refresh.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStatus();
    return () => { cancelled = true; };
  }, [demoExpiresAtProp]);

  // ── Derived ───────────────────────────────────────────────

  const daysRemaining = (() => {
    if (!expiresAt) return 0;
    const todayDate = estDateOnly(new Date());
    const expiresDate = estDateOnly(new Date(expiresAt));
    const startDate = profile?.demo_start_at
      ? estDateOnly(new Date(profile.demo_start_at))
      : new Date(expiresDate.getTime() - 30 * 86400000);
    const DAY_MS = 86400000;
    const totalDays = Math.round((expiresDate.getTime() - startDate.getTime()) / DAY_MS);
    const daysSinceStart = Math.round((todayDate.getTime() - startDate.getTime()) / DAY_MS);
    return Math.max(0, totalDays - daysSinceStart);
  })();

  const eyebrowText = isFirstTime ? 'DEMO ACTIVATED' : 'WELCOME BACK';
  const subtext = isFirstTime
    ? "Your $100,000 virtual portfolio is ready. Let's put it to work."
    : "You're trading with $100,000 of virtual money.";

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100dvh', background: 'var(--bg)', color: '#fff',
      }}>
        <Spinner />
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────

  if (fetchError) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', minHeight: '100dvh', background: 'var(--bg)',
        color: '#fff', padding: '24px', gap: '16px',
      }}>
        <p style={{ fontSize: '15px', color: 'rgba(255,255,255,0.60)', textAlign: 'center', margin: 0 }}>
          {fetchError}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '999px', padding: '10px 24px', color: 'var(--accent)',
            fontSize: '14px', fontWeight: 500, cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      minHeight: '100dvh', background: 'var(--bg)', color: '#fff',
      alignItems: 'center', padding: '12px 16px 16px', gap: 0,
    }}>
      {/* ═══ TOP: Orb + Eyebrow + Headline + Subtext ═══ */}
      <div style={{
        width: '100%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', minHeight: '36px',
      }}>
        <VantageOrb size={32} animate />
      </div>

      <p style={{
        margin: '10px 0 6px', fontSize: '11px', fontWeight: 500,
        color: 'var(--accent)', textTransform: 'uppercase',
        letterSpacing: '0.15em', textAlign: 'center',
      }}>
        {eyebrowText}
      </p>

      <h1 style={{ margin: '0 0 10px', textAlign: 'center', lineHeight: 1.15, fontSize: '36px' }}>
        <span style={{ display: 'block', fontWeight: 800, color: '#ffffff' }}>
          {daysRemaining === 1 ? 'You have 1 day' : `You have ${daysRemaining} days`}
        </span>
        <span style={{
          display: 'block', fontFamily: 'var(--font-serif)',
          fontWeight: 400, fontStyle: 'italic', color: '#ffffff',
        }}>
          left in demo.
        </span>
      </h1>

      <p style={{
        fontSize: '14px', fontWeight: 400, color: 'rgba(255,255,255,0.60)',
        textAlign: 'center', margin: '0 0 8px', lineHeight: 1.5, maxWidth: '340px',
      }}>
        {subtext}
      </p>

      {/* AI positioning — subtle, under subtext */}
      <p style={{
        fontSize: '13px', fontWeight: 400, color: '#94a3b8',
        textAlign: 'center', margin: '0 0 14px', lineHeight: 1.4,
        fontFamily: 'var(--font-sans)',
      }}>
        Institution-grade AI-based portfolio analysis. Now in your pocket.
      </p>

      {/* ═══ SECTION 1: CONTINUE IN DEMO ═══ */}
      <div style={{
        width: '100%', maxWidth: '380px',
        borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)', padding: '14px 14px 12px',
        marginBottom: '12px',
      }}>
        <p style={{
          margin: '0 0 12px', fontSize: '10px', fontWeight: 700,
          color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase',
          letterSpacing: '0.10em', textAlign: 'center',
        }}>
          Continue in demo
        </p>

        {/* Primary: Enter Vantage Demo */}
        <button
          onClick={onEnter || onContinue}
          style={{
            width: '100%', height: '48px', borderRadius: '999px',
            border: 'none', background: '#ffffff', color: '#000000',
            fontSize: '16px', fontWeight: 700, cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {isFirstTime ? 'Start trading \u2192' : 'Enter Vantage Demo \u2192'}
        </button>

        {/* ── or ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          margin: '10px 0', width: '100%',
        }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', fontWeight: 500 }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {/* Secondary: Connect a broker (still in demo) */}
        <button
          onClick={onConnectBroker}
          style={{
            width: '100%', height: '44px', borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'transparent', color: '#94a3b8',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Connect a broker &rarr;
        </button>
        <p style={{
          margin: '8px 0 0', fontSize: '11px', color: 'rgba(255,255,255,0.35)',
          textAlign: 'center', lineHeight: 1.4, fontFamily: 'var(--font-sans)',
        }}>
          Add real brokerage data alongside your demo.
          You&rsquo;ll stay in the demo.
        </p>
      </div>

      {/* ═══ DIVIDER ═══ */}
      <div style={{
        width: '100%', maxWidth: '240px', height: 1,
        background: 'rgba(255,255,255,0.06)', margin: '0 auto 12px',
      }} />

      {/* ═══ SECTION 2: UPGRADE CARD ═══ */}
      <div style={{
        width: '100%', maxWidth: '380px',
        borderRadius: '16px',
        border: '1px solid rgba(34,211,238,0.18)',
        background: 'rgba(34,211,238,0.04)',
        padding: '14px',
        marginBottom: '10px',
      }}>
        <p style={{
          margin: '0 0 4px', fontSize: '14px', fontWeight: 700,
          color: '#e2e8f0',
        }}>
          Ready for the real thing?
        </p>
        <p style={{
          margin: '0 0 12px', fontSize: '12px', color: 'rgba(255,255,255,0.50)',
          lineHeight: 1.5,
        }}>
          Silver: AI-powered view of your real portfolio.<br />
          Gold: trade it — live execution, options &amp; futures, bank-grade security.
        </p>
        <button
          onClick={(e) => {
            e.preventDefault();
            window.location.href = '/plans';
          }}
          style={{
            width: '100%', height: '42px', borderRadius: '999px',
            border: '1px solid rgba(34,211,238,0.25)',
            background: 'rgba(34,211,238,0.10)',
            color: '#22d3ee', fontSize: '14px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'var(--font-sans)',
          }}
        >
          See Silver &amp; Gold plans &rarr;
        </button>
      </div>

      {/* ═══ Settings note ═══ */}
      <p style={{
        margin: '0 0 16px', fontSize: '11px', fontWeight: 400,
        color: 'rgba(255,255,255,0.35)', textAlign: 'center',
        lineHeight: 1.5,
      }}>
        You can also do this anytime from Settings.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Named export for existing consumers
export { DemoCounterPage };
