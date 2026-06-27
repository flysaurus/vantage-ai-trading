// ─── Login Screen ─────────────────────────────────────────
// Email/password sign-in + Google OAuth.
// Redirects already-authenticated users to /.
// Handles ?error=expired and ?error=invalid URL params.

'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import Input from '@/components/ui/Input';
import { LoadingSplash } from '@/components/app/LoadingSplash';
import type { SplashMode } from '@/components/app/LoadingSplash';
import { getDemoStatus } from '@/lib/demo-utils';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

// ── Helpers ────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Gradient ───────────────────────────────────────────────

const GRADIENT = `radial-gradient(ellipse 150% 65% at 50% -15%, rgba(34,211,238,0.40) 0%, rgba(14,116,144,0.22) 35%, transparent 65%), radial-gradient(ellipse 70% 45% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%), #0a0f1e`;

// ── Component ──────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getSupabaseBrowserClient();
  }, []);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inlineError, setInlineError] = useState('');
  const [bannerError, setBannerError] = useState<{ text: string; tone: 'warning' | 'error' } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [splashMode, setSplashMode] = useState<SplashMode | null>(null);
  const [splashDays, setSplashDays] = useState(0);

  const canSubmit = isValidEmail(email) && password.length > 0 && !submitting;

  // ── Already authenticated? Redirect instantly ───────────
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        router.replace('/');
      } else {
        setCheckingSession(false);
      }
    });
  }, [supabase, router]);

  // ── Handle URL error params (browser-only, avoids useSearchParams SSR crash) ─
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'expired') {
      setBannerError({
        text: 'That link has expired. Request a new magic link.',
        tone: 'warning',
      });
    } else if (err === 'invalid') {
      setBannerError({
        text: 'Incorrect email or password.',
        tone: 'error',
      });
    }
    if (err) {
      window.history.replaceState({}, '', '/login');
    }
  }, []);

  // ── Sign in handler ─────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (!canSubmit || !supabase) return;
    setSubmitting(true);
    setInlineError('');

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setInlineError('Incorrect email or password.');
      setPassword('');
      setSubmitting(false);
      return;
    }

    // Fetch user profile to determine splash mode
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const { user } = await res.json();
        if (user.demoStartAt) {
          const status = getDemoStatus(user.demoStartAt, user.demoExpiresAt);
          setSplashMode('demo');
          setSplashDays(status.daysRemaining);
          setSubmitting(false);
          return;
        }
        // No demo started — skip splash, go directly to app
      }
    } catch {
      // Fall through
    }

    // No demo: skip splash, go directly to app
    router.push('/');
    router.refresh();
  }, [canSubmit, email, password, supabase, router]);

  // ── Google OAuth ───────────────────────────────────────
  const handleGoogleLogin = useCallback(async () => {
    if (!supabase) return;
    setSubmitting(true);
    setInlineError('');

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/complete',
      },
    });
    if (error) {
      setInlineError('Something went wrong with Google sign-in.');
      setSubmitting(false);
    }
  }, [supabase]);

  // ── Enter key ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) handleLogin();
  };

  // ── Splash complete → navigate to app ────────────────────
  const handleSplashComplete = useCallback(() => {
    router.push('/');
    router.refresh();
  }, [router]);

  // ── Spinner while checking session ─────────────────────
  if (checkingSession) {
    return (
      <div
        style={{
          height: '100dvh',
          background: GRADIENT,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2 size={32} color="var(--accent)" style={{ animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Splash (after successful sign-in) ────────────────────
  if (splashMode) {
    return (
      <div style={{ position: 'relative', height: '100dvh', background: GRADIENT, overflow: 'hidden' }}>
        <LoadingSplash
          mode={splashMode}
          daysRemaining={splashMode === 'demo' ? splashDays : undefined}
          onComplete={handleSplashComplete}
        />
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div
      onKeyDown={handleKeyDown}
      style={{
        height: '100dvh',
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ═══ TOP BAR (60px) ═══ */}
      <div
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <VantageOrb size={44} animate showEntrance={false} />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 24px 48px',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* ── Headline ── */}
        <h1 style={{ textAlign: 'center', margin: '0 0 32px' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '42px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.15,
            }}
          >
            Welcome
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '42px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
              lineHeight: 1.15,
            }}
          >
            back.
          </span>
        </h1>

        {/* ── Banner error (URL param based) ── */}
        {bannerError && (
          <div
            style={{
              marginBottom: '16px',
              padding: '12px 16px',
              borderRadius: '12px',
              display: 'flex',
              gap: '10px',
              background:
                bannerError.tone === 'warning'
                  ? 'var(--warning-10)'
                  : 'var(--loss-10)',
              border: `1px solid ${
                bannerError.tone === 'warning'
                  ? 'var(--warning)'
                  : 'var(--loss)'
              }`,
            }}
          >
            <AlertTriangle
              size={16}
              color={
                bannerError.tone === 'warning'
                  ? 'var(--warning)'
                  : 'var(--loss)'
              }
              style={{ flexShrink: 0, marginTop: '1px' }}
            />
            <span
              style={{
                fontSize: '14px',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                lineHeight: 1.5,
              }}
            >
              {bannerError.text}
            </span>
          </div>
        )}

        {/* ── Form ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Email */}
          <Input
            label="EMAIL"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(v) => {
              setEmail(v);
              setInlineError('');
            }}
            disabled={submitting}
            autoFocus
          />

          {/* Password */}
          <div>
            <Input
              label="PASSWORD"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={(v) => {
                setPassword(v);
                setInlineError('');
              }}
              showToggle
              disabled={submitting}
            />

            {/* Inline error */}
            {inlineError && (
              <p
                style={{
                  color: 'var(--loss)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  margin: '6px 0 0',
                }}
              >
                {inlineError}
              </p>
            )}

            {/* Forgot password link */}
            <div style={{ textAlign: 'right', marginTop: '6px' }}>
              <span
                onClick={() => router.push('/auth/forgot-password')}
                style={{
                  color: 'var(--accent)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                }}
              >
                Forgot password?
              </span>
            </div>
          </div>
        </div>

        {/* ── Bottom zone ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginTop: '24px',
          }}
        >
          {/* Sign In */}
          <button
            onClick={handleLogin}
            disabled={!canSubmit}
            style={{
              width: '100%',
              height: '56px',
              borderRadius: '999px',
              border: 'none',
              background: canSubmit ? '#ffffff' : 'rgba(255,255,255,0.20)',
              color: canSubmit ? '#000000' : 'rgba(0,0,0,0.40)',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: canSubmit ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 200ms var(--ease-out)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={20} style={{ animation: 'spin-submit 0.7s linear infinite' }} />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>

          {/* Divider */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}
          >
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            <span style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>
              or
            </span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleLogin}
            disabled={submitting}
            style={{
              width: '100%',
              height: '56px',
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: 'transparent',
              color: '#ffffff',
              fontSize: '17px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.4 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'opacity 200ms var(--ease-out)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>
        </div>

        {/* ── New to Vantage? ── */}
        <p
          style={{
            marginTop: '24px',
            fontSize: '13px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
          }}
        >
          New to Vantage?{' '}
          <span
            onClick={() => router.push('/')}
            style={{
              color: 'var(--accent)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Find your investor style →
          </span>
        </p>
      </div>

      <style>{`
        @keyframes spin-submit { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
