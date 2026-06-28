// ─── /welcome — Post email-confirmation landing ─────────────
// User lands here after clicking the confirmation link.
// Session is active. This page:
//  1. Reads user_metadata from the Supabase session
//  2. Guards against returning users (→ redirect to /)
//  3. Upserts public.users via /api/user/setup
//  4. Shows "YOU'RE IN." celebration screen
//  5. Fires demo/start or connections/start in background
//  6. Transitions to DemoCounterPage or ConnectionLoadingPage
//
// Client component — Supabase browser client for getSession().

'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { VantageOrb } from '@/components/brand/VantageOrb';
import DemoCounterPage from '@/components/demo/DemoCounterPage';
import ConnectionLoadingPage from '@/components/broker/ConnectionLoadingPage';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// ── Types ───────────────────────────────────────────────────

type Status = 'loading' | 'success' | 'error';
type NextStep =
  | 'demo-counter'
  | 'connection-loading'
  | 'broker-selection'
  | null;

// ── Spinner ─────────────────────────────────────────────────

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid rgba(34,211,238,0.15)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.6s linear infinite',
        flexShrink: 0,
      }}
    />
  );
}

// ── Celebration screen ─────────────────────────────────────

function CelebrationScreen({
  firstName,
  status,
}: {
  firstName: string;
  status: Status;
}) {
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
      }}
    >
      {/* Top bar */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60px',
        }}
      >
        <VantageOrb size={44} animate />
      </div>

      {/* Hero */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          gap: '28px',
        }}
      >
        {/* Large orb */}
        <VantageOrb size={180} animate showEntrance />

        {/* Headline */}
        <h1 style={{ margin: 0, textAlign: 'center', lineHeight: 1.1 }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '48px',
              fontWeight: 800,
              color: '#ffffff',
            }}
          >
            {"You're"}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '48px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
            }}
          >
            in.
          </span>
        </h1>

        {/* Subtext */}
        <p
          style={{
            fontSize: '16px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.60)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          Welcome to Vantage, {firstName}.
        </p>

        {/* Status */}
        {status === 'loading' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
              color: 'rgba(255,255,255,0.40)',
            }}
          >
            <Spinner size={14} />
            Setting up your account…
          </div>
        )}
        {status === 'success' && (
          <span
            style={{
              fontSize: '12px',
              fontWeight: 500,
              color: 'var(--accent)',
            }}
          >
            ✓ All set.
          </span>
        )}
      </div>
    </div>
  );
}

// ── Error screen ────────────────────────────────────────────

function ErrorScreen({
  message,
  onRetry,
  exhausted,
}: {
  message: string;
  onRetry: () => void;
  exhausted: boolean;
}) {
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
          fontWeight: 400,
          color: 'rgba(255,255,255,0.60)',
          textAlign: 'center',
          margin: 0,
          maxWidth: '300px',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>

      <button
        onClick={onRetry}
        style={{
          width: '100%',
          maxWidth: '260px',
          height: '48px',
          borderRadius: '999px',
          border: 'none',
          background: 'var(--accent)',
          color: '#000',
          fontSize: '15px',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Try again
      </button>

      {exhausted && (
        <a
          href="mailto:support@vantageai.app"
          style={{
            fontSize: '13px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.40)',
            textDecoration: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            paddingBottom: '2px',
          }}
        >
          Contact support
        </a>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────

export default function WelcomePage() {
  const router = useRouter();

  const [status, setStatus] = useState<Status>('loading');
  const [nextStep, setNextStep] = useState<NextStep>(null);
  const [demoExpiresAt, setDemoExpiresAt] = useState<string | null>(null);
  const [pendingConnectionType, setPendingConnectionType] = useState<
    'snaptrade' | 'alpaca' | 'tastytrade' | null
  >(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [firstName, setFirstName] = useState('');

  // Refs to prevent double-fires
  const initialized = useRef(false);
  const retryCount = useRef(0);
  const [exhausted, setExhausted] = useState(false);
  const [showCelebration, setShowCelebration] = useState(true);

  // ── Bootstrap ────────────────────────────────────────────

  const bootstrap = useCallback(async () => {
    // Allow retries up to 3 attempts (initial + 2 retries)
    if (retryCount.current >= 3) return;
    initialized.current = true;

    try {
      // 1. Get session
      const supabase = getSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push('/login?error=no_session');
        return;
      }

      const meta = (session.user.user_metadata || {}) as Record<
        string,
        string | undefined
      >;

      const first = meta.first_name || '';
      const last = meta.last_name || '';
      const investorStyle = meta.investor_style || '';
      const riskTolerance = meta.risk_tolerance || '';
      const pendingChoice = meta.pending_choice as string | undefined;
      const pendingConnType =
        (meta.pending_connection_type as string) || null;

      setFirstName(first || 'trader');

      // ── Call /api/user/setup ─────────────────────────────
      // Pass access_token directly so the route can verify auth
      // without relying solely on cookies (belt-and-suspenders).
      const setupRes = await fetch('/api/user/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: session.access_token,
          first_name: first,
          last_name: last,
          investor_style: investorStyle,
          risk_tolerance: riskTolerance,
        }),
        credentials: 'include',
      });

      if (!setupRes.ok) {
        const errData = await setupRes.json().catch(() => null);
        const errMsg =
          (errData as { error?: string })?.error ||
          `HTTP ${setupRes.status}: ${setupRes.statusText}`;
        console.error('[welcome] /api/user/setup failed:', errMsg);
        throw new Error(errMsg);
      }

      const setupData = await setupRes.json();

      // Returning user guard — hit /welcome by mistake
      if (setupData.returning) {
        router.push('/');
        return;
      }

      // ── Background API calls based on pendingChoice ──────

      if (pendingChoice === 'demo') {
        const demoRes = await fetch('/api/demo/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: session.access_token,
          }),
          credentials: 'include',
        });

        if (!demoRes.ok) {
          throw new Error('Failed to activate demo account');
        }

        const demoData = await demoRes.json();
        setDemoExpiresAt(demoData.demo_expires_at ?? null);
        setNextStep('demo-counter');
      } else if (pendingChoice === 'broker' && pendingConnType) {
        const connRes = await fetch('/api/connections/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connection_type: pendingConnType,
          }),
          credentials: 'include',
        });

        if (!connRes.ok) {
          throw new Error('Failed to initiate broker connection');
        }

        setPendingConnectionType(
          pendingConnType as
            | 'snaptrade'
            | 'alpaca'
            | 'tastytrade',
        );
        setNextStep('connection-loading');
      } else {
        // No pendingChoice — redirect to main app for broker selection
        setNextStep('broker-selection');
      }

      setStatus('success');
    } catch (err: unknown) {
      retryCount.current += 1;

      // After 2 failures, show fixed message + support link
      if (retryCount.current >= 2) {
        setExhausted(true);
        setErrorMsg('Something went wrong setting up your account.');
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Something went wrong. Please try again.',
        );
      }

      setStatus('error');
      // Allow retry button to re-trigger bootstrap
      initialized.current = false;
    }
  }, [router]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // ── Auto-advance after 2.5s ─────────────────────────────

  useEffect(() => {
    if (status !== 'success') return;

    const timer = setTimeout(() => {
      if (nextStep === 'broker-selection') {
        router.push('/');
      } else {
        setShowCelebration(false);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [status, nextStep, router]);

  // ── Render ───────────────────────────────────────────────

  // Error state
  if (status === 'error') {
    return <ErrorScreen message={errorMsg} onRetry={bootstrap} exhausted={exhausted} />;
  }

  // Celebration screen (visible during loading + min 2.5s of success)
  if (showCelebration) {
    return <CelebrationScreen firstName={firstName} status={status} />;
  }

  // Transition screens
  if (nextStep === 'demo-counter') {
    return (
      <DemoCounterPage
        isFirstTime
        demoExpiresAt={demoExpiresAt}
        onContinue={() => router.push('/')}
      />
    );
  }

  if (nextStep === 'connection-loading') {
    return (
      <ConnectionLoadingPage
        connectionType={pendingConnectionType}
        onRetry={() => router.push('/')}
      />
    );
  }

  // Fallback: broker-selection → already redirecting
  return null;
}
