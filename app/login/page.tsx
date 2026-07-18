// ─── Login Screen ─────────────────────────────────────────
// Email/password sign-in + forgot password flow.
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

function getSafeRedirect(): string {
  if (typeof window === 'undefined') return '/';
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('redirectTo');
  // Prevent open redirect attacks — only allow same-site paths
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
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

  // ── Forgot password flow ────────────────────────────
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [resetError, setResetError] = useState('');

  // ── Email not confirmed ─────────────────────────────
  const [showEmailNotConfirmed, setShowEmailNotConfirmed] = useState(false);
  const [resendConfirmState, setResendConfirmState] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [resendConfirmCooldown, setResendConfirmCooldown] = useState(0);

  const canSubmit = isValidEmail(email) && password.length > 0 && !submitting;

  // ── Profile processing (extracted for reuse) ────────
  const processProfile = useCallback(async (user: any) => {
    // ── 1. Email not yet verified (first login after signup) ──
    // Send a fresh OTP and redirect to verify-email page
    if (user.email_verified === false) {
      setSubmitting(false);
      await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      });
      window.location.href = `/verify-email?email=${encodeURIComponent(user.email)}`;
      return;
    }

    // ── 2. MFA enabled — redirect to MFA verification ──
    if (user.mfa_enabled === true) {
      setSubmitting(false);
      window.sessionStorage.setItem('vantage_mfa_pending', 'true');
      window.location.href = '/verify-mfa';
      return;
    }

    // ── 3. MFA not set up — force setup ──
    if (user.mfa_enabled === false) {
      setSubmitting(false);
      window.location.href = '/setup-mfa';
      return;
    }
    // If mfa_enabled is absent (undefined), columns don't exist — bypass

    // ── 4. Demo splash check ──
    if (user.demo_start_at) {
      const status = getDemoStatus(user.demo_start_at, user.demo_expires_at);
      setSplashMode('demo');
      setSplashDays(status.daysRemaining);
      setSubmitting(false);
      return;
    }

    // No verification needed, no MFA, no demo — go to app
    window.location.href = getSafeRedirect();
  }, []);

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

  // ── Resend confirmation countdown ────────────────────
  useEffect(() => {
    if (resendConfirmCooldown <= 0) return;
    const t = setInterval(() => {
      setResendConfirmCooldown((prev) => {
        if (prev <= 1) { setResendConfirmState('idle'); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [resendConfirmCooldown]);

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
      // Unconfirmed email — show resend UI instead of generic error
      if (
        error.message.includes('Email not confirmed') ||
        error.message.includes('email_not_confirmed')
      ) {
        setInlineError('');
        setShowEmailNotConfirmed(true);
        setPassword('');
        setSubmitting(false);
        return;
      }

      setInlineError(error.message);
      setPassword('');
      setSubmitting(false);
      return;
    }

    // ── Fetch user profile once ─────────────────────────
    // Single /api/auth/me call for email_verified, MFA, and demo status
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });

      if (!meRes.ok) {
        // Auth check failed (e.g., session cookies not readable yet or middleware redirect)
        // Retry once after a short delay — cookies may need an event-loop tick to settle
        console.warn('[login] /api/auth/me returned', meRes.status, '— retrying after 300ms');
        await new Promise((r) => setTimeout(r, 300));
        const retryRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (!retryRes.ok) {
          setInlineError(
            'Could not verify your account. Please refresh and try again.'
          );
          setSubmitting(false);
          return;
        }
        const { user: retryUser } = await retryRes.json();
        await processProfile(retryUser);
        return;
      }

      const { user } = await meRes.json();
      await processProfile(user);
    } catch (err) {
      console.error('[login] /api/auth/me failed:', err);
      setInlineError(
        'Could not verify your account. Please refresh and try again.'
      );
      setSubmitting(false);
      return;
    }
  }, [canSubmit, email, password, supabase, processProfile]);

  // ── Forgot password handler ───────────────────────────
  const handleForgotPassword = useCallback(async () => {
    if (!isValidEmail(resetEmail) || !supabase) return;
    setResetSending(true);
    setResetError('');

    try {
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
      const { error } = await supabase.auth.resetPasswordForEmail(
        resetEmail.trim(),
        {
          redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
        },
      );

      if (error) {
        // Rate limit or other server error
        if (error.message?.includes('rate') || error.status === 429) {
          setResetError('Too many requests. Please wait a minute and try again.');
        } else {
          setResetError(error.message);
        }
        setResetSending(false);
      } else {
        setResetSent(true);
        setResetSending(false);
      }
    } catch {
      setResetError('Something went wrong. Please try again.');
      setResetSending(false);
    }
  }, [resetEmail, supabase]);

  // ── Enter key ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) handleLogin();
  };

  // ── Splash complete → navigate to app ────────────────────
  const handleSplashComplete = useCallback(() => {
    // Hard navigation to go through middleware (session-only cookie)
    window.location.href = getSafeRedirect();
  }, []);

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

            {/* Email not confirmed UI */}
            {showEmailNotConfirmed && (
              <div style={{ marginTop: '6px' }}>
                <p
                  style={{
                    color: 'var(--warning)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-sans)',
                    margin: '0 0 4px',
                    fontWeight: 500,
                  }}
                >
                  Email not confirmed yet.
                </p>
                <p
                  style={{
                    color: 'rgba(255,255,255,0.50)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-sans)',
                    margin: '0 0 8px',
                    lineHeight: 1.4,
                  }}
                >
                  Please check your inbox for the confirmation link.
                </p>
                <span
                  onClick={async () => {
                    if (resendConfirmState !== 'idle' || !supabase) return;
                    setResendConfirmState('loading');
                    const { error: resendErr } = await supabase.auth.resend({
                      type: 'signup',
                      email: email.trim(),
                      options: {
                        emailRedirectTo: 'https://vantage-ai-trading.vercel.app/auth/callback',
                      },
                    });
                    if (resendErr) {
                      setResendConfirmState('idle');
                      setInlineError('Could not resend. Try again.');
                      return;
                    }
                    setResendConfirmState('sent');
                    setResendConfirmCooldown(30);
                  }}
                  style={{
                    color: resendConfirmState === 'sent' ? 'var(--gain)' : 'var(--accent)',
                    fontSize: '13px',
                    fontFamily: 'var(--font-sans)',
                    cursor: resendConfirmState === 'idle' ? 'pointer' : 'default',
                  }}
                >
                  {resendConfirmState === 'sent'
                    ? `Email resent ✓ (${resendConfirmCooldown}s)`
                    : resendConfirmState === 'loading'
                      ? 'Sending…'
                      : 'Resend confirmation email'}
                </span>
              </div>
            )}

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
                onClick={() => {
                  setShowForgotPassword(true);
                  setResetSent(false);
                  setResetError('');
                  if (email) setResetEmail(email);
                }}
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

        {/* ═══ FORGOT PASSWORD INLINE ═══ */}
        {showForgotPassword && !resetSent && (
          <div
            style={{
              marginTop: '24px',
              padding: '24px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <p
              style={{
                fontSize: '14px',
                color: 'rgba(255,255,255,0.60)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 16px',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              Enter your email to reset your password.
            </p>

            <Input
              label="EMAIL"
              type="email"
              placeholder="your@email.com"
              value={resetEmail}
              onChange={(v) => {
                setResetEmail(v);
                setResetError('');
              }}
              disabled={resetSending}
              autoFocus
            />

            {resetError && (
              <p
                style={{
                  color: 'var(--loss)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  margin: '8px 0 0',
                }}
              >
                {resetError}
              </p>
            )}

            <button
              onClick={handleForgotPassword}
              disabled={resetSending || !isValidEmail(resetEmail)}
              style={{
                width: '100%',
                height: '48px',
                borderRadius: '999px',
                border: 'none',
                background:
                  !resetSending && isValidEmail(resetEmail)
                    ? 'var(--accent)'
                    : 'rgba(255,255,255,0.15)',
                color: !resetSending && isValidEmail(resetEmail) ? '#000' : 'rgba(255,255,255,0.30)',
                fontSize: '15px',
                fontWeight: 600,
                fontFamily: 'var(--font-sans)',
                cursor:
                  !resetSending && isValidEmail(resetEmail)
                    ? 'pointer'
                    : 'default',
                marginTop: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'background 200ms var(--ease-out)',
              }}
            >
              {resetSending ? (
                <>
                  <Loader2 size={18} style={{ animation: 'spin-submit 0.7s linear infinite' }} />
                  Sending…
                </>
              ) : (
                'Send reset link'
              )}
            </button>

            <button
              onClick={() => {
                setShowForgotPassword(false);
                setResetError('');
              }}
              style={{
                width: '100%',
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.40)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                padding: '12px 0 0',
                textAlign: 'center',
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ═══ FORGOT PASSWORD — SENT ═══ */}
        {showForgotPassword && resetSent && (
          <div
            style={{
              marginTop: '24px',
              padding: '24px',
              borderRadius: '16px',
              background: 'rgba(34,211,238,0.06)',
              border: '1px solid rgba(34,211,238,0.15)',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: '15px',
                color: 'rgba(255,255,255,0.80)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 8px',
                fontWeight: 600,
              }}
            >
              Check your email
            </p>
            <p
              style={{
                fontSize: '13px',
                color: 'rgba(255,255,255,0.50)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 16px',
                lineHeight: 1.5,
              }}
            >
              If an account exists for{' '}
              <span style={{ color: 'var(--accent)' }}>{resetEmail}</span>,
              {' '}a reset link has been sent.
            </p>
            <button
              onClick={() => {
                setShowForgotPassword(false);
                setResetSent(false);
                setResetEmail('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--accent)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              Back to sign in
            </button>
          </div>
        )}

        {/* ── Sign In + CTA ── (hidden during forgot password) */}
        {!showForgotPassword && (
          <>
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
          </>
        )}
      </div>

      <style>{`
        @keyframes spin-submit { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
