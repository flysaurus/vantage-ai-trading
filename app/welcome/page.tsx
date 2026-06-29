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
  const hasRun = useRef(false);
  const retryCount = useRef(0);
  const [exhausted, setExhausted] = useState(false);
  const [showCelebration, setShowCelebration] = useState(true);

  // ── Bootstrap with session wait loop ─────────────────────

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const run = async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        // ── Wait for session cookie to propagate ──────────
        // after redirect from /auth/complete
        let session = null;

        for (let i = 0; i < 10; i++) {
          const { data } = await supabase.auth.getSession();

          if (data?.session) {
            session = data.session;
            break;
          }

          console.log(
            `[welcome] waiting for session... attempt ${i + 1}/10`
          );
          await new Promise(r => setTimeout(r, 500));
        }

        if (!session) {
          console.error('[welcome] no session found');
          router.push('/login?error=no_session');
          return;
        }

        console.log('[welcome] session confirmed:', session.user.id);

        // ── Returning user guard ──────────────────────────
        // Check if public.users already has demo_start_at or connection_type
        const { data: existingUser } = await (supabase
          .from('users') as any)
          .select('demo_start_at, connection_type')
          .eq('id', session.user.id)
          .maybeSingle();

        if (existingUser?.demo_start_at || existingUser?.connection_type) {
          // Already set up — skip to app
          router.push('/');
          return;
        }

        // ── Read metadata from session ────────────────────
        const meta = session.user.user_metadata;
        const firstName = meta.first_name || '';
        setFirstName(firstName || 'trader');

        // ── Call /api/user/setup ──────────────────────────
        const setupRes = await fetch('/api/user/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            first_name: meta.first_name ?? '',
            last_name: meta.last_name ?? '',
            investor_style: meta.investor_style ?? '',
            risk_tolerance: meta.risk_tolerance ?? '',
          }),
        });

        if (!setupRes.ok) {
          console.error('[welcome] setup failed:', await setupRes.text());
          // Retry once after 1 second
          await new Promise(r => setTimeout(r, 1000));
          await fetch('/api/user/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              first_name: meta.first_name ?? '',
              last_name: meta.last_name ?? '',
              investor_style: meta.investor_style ?? '',
              risk_tolerance: meta.risk_tolerance ?? '',
            }),
          });
          // Continue regardless — don't block user
        }

        // ── Fire demo or broker API ───────────────────────

        if (meta.pending_choice === 'demo') {
          const demoRes = await fetch('/api/demo/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
          });

          if (demoRes.ok) {
            const demoData = await demoRes.json();
            setDemoExpiresAt(demoData.demo_expires_at ?? null);
          } else {
            console.error('[welcome] demo start failed:', await demoRes.text());
          }
          setNextStep('demo-counter');
        } else if (meta.pending_choice === 'broker') {
          await fetch('/api/connections/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              connection_type: meta.pending_connection_type,
            }),
          });
          setNextStep('connection-loading');
        } else {
          // Edge case — no pending choice
          setNextStep('broker-selection');
        }

        setStatus('success');
      } catch (err: unknown) {
        console.error('[welcome] unhandled error:', err);

        retryCount.current += 1;

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
        // Allow retry
        hasRun.current = false;
      }
    };

    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Retry handler ────────────────────────────────────────

  const handleRetry = useCallback(() => {
    hasRun.current = false;
    setStatus('loading');
    setExhausted(false);
  }, []);

  // Re-run when status flips back to 'loading' via retry
  useEffect(() => {
    if (status !== 'loading' || hasRun.current) return;
    hasRun.current = true;

    const runRetry = async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        let session = null;
        for (let i = 0; i < 10; i++) {
          const { data } = await supabase.auth.getSession();
          if (data?.session) {
            session = data.session;
            break;
          }
          await new Promise(r => setTimeout(r, 500));
        }

        if (!session) {
          router.push('/login?error=no_session');
          return;
        }

        const meta = session.user.user_metadata;
        const firstName = meta.first_name || '';
        setFirstName(firstName || 'trader');

        const setupRes = await fetch('/api/user/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            first_name: meta.first_name ?? '',
            last_name: meta.last_name ?? '',
            investor_style: meta.investor_style ?? '',
            risk_tolerance: meta.risk_tolerance ?? '',
          }),
        });

        if (!setupRes.ok) {
          await new Promise(r => setTimeout(r, 1000));
          await fetch('/api/user/setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              first_name: meta.first_name ?? '',
              last_name: meta.last_name ?? '',
              investor_style: meta.investor_style ?? '',
              risk_tolerance: meta.risk_tolerance ?? '',
            }),
          });
        }

        if (meta.pending_choice === 'demo') {
          const demoRes = await fetch('/api/demo/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
          });
          if (demoRes.ok) {
            const demoData = await demoRes.json();
            setDemoExpiresAt(demoData.demo_expires_at ?? null);
          }
          setNextStep('demo-counter');
        } else if (meta.pending_choice === 'broker') {
          await fetch('/api/connections/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ connection_type: meta.pending_connection_type }),
          });
          setNextStep('connection-loading');
        } else {
          setNextStep('broker-selection');
        }

        setStatus('success');
      } catch (err: unknown) {
        retryCount.current += 1;
        if (retryCount.current >= 2) {
          setExhausted(true);
          setErrorMsg('Something went wrong setting up your account.');
        } else {
          setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
        }
        setStatus('error');
        hasRun.current = false;
      }
    };

    runRetry();
  }, [status, router]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return <ErrorScreen message={errorMsg} onRetry={handleRetry} exhausted={exhausted} />;
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
