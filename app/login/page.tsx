// ─── Login Screen (OTP) ────────────────────────────────────
// 6-digit OTP sign-in via Supabase Auth.
// Flow: email → send code → enter 6 digits → verify → session created in cookies.
//
// Uses Supabase's native signInWithOtp + verifyOtp.
// OTP email is sent by Supabase (customize template in Supabase Dashboard →
//   Authentication → Email Templates → Magic Link).
// Middleware, requireAuth, and session management remain unchanged.

'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, ArrowLeft, Mail, CheckCircle } from 'lucide-react';
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
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

// ── Gradient ───────────────────────────────────────────────

const GRADIENT = `radial-gradient(ellipse 150% 65% at 50% -15%, rgba(34,211,238,0.40) 0%, rgba(14,116,144,0.22) 35%, transparent 65%), radial-gradient(ellipse 70% 45% at 90% 100%, rgba(99,102,241,0.15) 0%, transparent 70%), #0a0f1e`;

// ── Login stages ───────────────────────────────────────────

type Stage = 'email' | 'code' | 'verifying' | 'splash';

// ── Component ──────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return getSupabaseBrowserClient();
  }, []);

  // ── State ──────────────────────────────────────────────
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [splashMode, setSplashMode] = useState<SplashMode | null>(null);
  const [splashDays, setSplashDays] = useState(0);
  const [checkingSession, setCheckingSession] = useState(true);

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

  // ── Resend countdown ────────────────────────────────────
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // ── Send OTP ────────────────────────────────────────────
  const handleSendCode = useCallback(async () => {
    if (!isValidEmail(email) || !supabase || sendingCode) return;
    setSendingCode(true);
    setError('');

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // No emailRedirectTo → sends 6-digit OTP, not magic link
        shouldCreateUser: false, // existing users only
      },
    });

    setSendingCode(false);

    if (sendError) {
      // Rate limiting
      if (sendError.message?.includes('rate') || sendError.status === 429) {
        setError('Too many attempts. Please wait before requesting another code.');
        return;
      }
      // Email not found? Supabase won't reveal this, but if it happens:
      setError(sendError.message || 'Failed to send code. Try again.');
      return;
    }

    // Success — switch to code input
    setStage('code');
    setResendCooldown(30);
  }, [email, supabase, sendingCode]);

  // ── Resend OTP ──────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (!isValidEmail(email) || !supabase || resendCooldown > 0) return;
    setSendingCode(true);
    setError('');

    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false },
    });

    setSendingCode(false);

    if (sendError) {
      if (sendError.message?.includes('rate') || sendError.status === 429) {
        setError('Please wait before requesting another code.');
      } else {
        setError(sendError.message || 'Failed to resend. Try again.');
      }
      return;
    }

    setCode(''); // Clear old code
    setResendCooldown(30);
  }, [email, supabase, resendCooldown]);

  // ── Verify OTP + handle post-login ──────────────────────
  const handleVerify = useCallback(async () => {
    if (!isValidEmail(email) || code.length !== 6 || !supabase) return;
    setStage('verifying');
    setError('');

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code,
      type: 'email',
    });

    if (verifyError) {
      setStage('code');
      if (verifyError.message?.includes('expired')) {
        setError('This code has expired. Request a new one.');
      } else if (verifyError.message?.includes('invalid')) {
        setError('Incorrect code. Check your email and try again.');
      } else {
        setError(verifyError.message);
      }
      return;
    }

    if (!data.session) {
      setStage('code');
      setError('Verification failed. Please try again.');
      return;
    }

    // ── Session created → check MFA ───────────────────────
    try {
      const meRes = await fetch('/api/auth/me', { credentials: 'include' });
      if (meRes.ok) {
        const { user } = await meRes.json();
        if (user.mfa_enabled === true) {
          window.sessionStorage.setItem('vantage_mfa_pending', 'true');
          router.replace('/verify-mfa');
          return;
        }
        if (user.mfa_enabled === false) {
          router.replace('/setup-mfa');
          return;
        }
      }
    } catch { /* fall through */ }

    // ── Check demo status for splash ──────────────────────
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const { user } = await res.json();
        if (user.demoStartAt) {
          const status = getDemoStatus(user.demoStartAt, user.demoExpiresAt);
          setSplashMode('demo');
          setSplashDays(status.daysRemaining);
          return;
        }
      }
    } catch { /* fall through */ }

    // No splash needed — go to app
    window.location.href = getSafeRedirect();
  }, [email, code, supabase, router]);

  // ── Handle code input (digits only, max 6) ──────────────
  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError('');
  };

  // ── Enter key ────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (stage === 'email' && e.key === 'Enter') {
      handleSendCode();
    } else if (stage === 'code' && e.key === 'Enter' && code.length === 6) {
      handleVerify();
    }
  };

  // ── Splash complete → navigate to app ────────────────────
  const handleSplashComplete = useCallback(() => {
    window.location.href = getSafeRedirect();
  }, []);

  // ── Spinner while checking session ─────────────────────
  if (checkingSession || stage === 'splash') {
    if (stage === 'splash' && splashMode) {
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
        {stage === 'code' && (
          <button
            onClick={() => {
              setStage('email');
              setCode('');
              setError('');
            }}
            style={{
              position: 'absolute',
              left: '16px',
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.60)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '14px',
              fontFamily: 'var(--font-sans)',
              padding: 0,
            }}
          >
            <ArrowLeft size={18} />
            Back
          </button>
        )}
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

        {/* ═══ STAGE: Email input ═══ */}
        {stage === 'email' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <Input
                label="EMAIL"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  setError('');
                }}
                disabled={sendingCode}
                autoFocus
              />

              {error && (
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '12px',
                    display: 'flex',
                    gap: '10px',
                    background: 'var(--loss-10)',
                    border: '1px solid var(--loss)',
                  }}
                >
                  <AlertTriangle
                    size={16}
                    color="var(--loss)"
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
                    {error}
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginTop: '24px' }}>
              <button
                onClick={handleSendCode}
                disabled={!isValidEmail(email) || sendingCode}
                style={{
                  width: '100%',
                  height: '56px',
                  borderRadius: '999px',
                  border: 'none',
                  background:
                    isValidEmail(email) && !sendingCode
                      ? '#ffffff'
                      : 'rgba(255,255,255,0.20)',
                  color:
                    isValidEmail(email) && !sendingCode
                      ? '#000000'
                      : 'rgba(0,0,0,0.40)',
                  fontSize: '17px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-sans)',
                  cursor:
                    isValidEmail(email) && !sendingCode ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'background 200ms var(--ease-out)',
                }}
              >
                {sendingCode ? (
                  <>
                    <Loader2 size={20} style={{ animation: 'spin-submit 0.7s linear infinite' }} />
                    Sending code…
                  </>
                ) : (
                  'Send sign-in code'
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

        {/* ═══ STAGE: Code input ═══ */}
        {(stage === 'code' || stage === 'verifying') && (
          <>
            {/* Email display (read-only) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px',
                padding: '10px 16px',
                borderRadius: '12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <Mail size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span
                style={{
                  fontSize: '14px',
                  color: 'rgba(255,255,255,0.70)',
                  fontFamily: 'var(--font-sans)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {email}
              </span>
            </div>

            <p
              style={{
                fontSize: '13px',
                color: 'rgba(255,255,255,0.45)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 20px',
                textAlign: 'center',
              }}
            >
              Enter the 6-digit code from your email
            </p>

            {/* OTP Code Input — large, centered, monospace */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => handleCodeChange(e.target.value)}
                placeholder="000000"
                disabled={stage === 'verifying'}
                autoFocus
                style={{
                  width: '240px',
                  height: '64px',
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${error ? 'var(--loss)' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '14px',
                  padding: '0 16px',
                  color: '#ffffff',
                  fontSize: '32px',
                  fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
                  letterSpacing: '14px',
                  textAlign: 'center',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  borderRadius: '12px',
                  display: 'flex',
                  gap: '10px',
                  background: 'var(--loss-10)',
                  border: '1px solid var(--loss)',
                }}
              >
                <AlertTriangle
                  size={16}
                  color="var(--loss)"
                  style={{ flexShrink: 0, marginTop: '1px' }}
                />
                <div style={{ flex: 1 }}>
                  <span
                    style={{
                      fontSize: '14px',
                      color: 'var(--text-primary)',
                      fontFamily: 'var(--font-sans)',
                      lineHeight: 1.5,
                    }}
                  >
                    {error}
                  </span>
                </div>
              </div>
            )}

            {/* Verify button */}
            <div style={{ marginTop: '24px' }}>
              <button
                onClick={handleVerify}
                disabled={code.length !== 6 || stage === 'verifying'}
                style={{
                  width: '100%',
                  height: '56px',
                  borderRadius: '999px',
                  border: 'none',
                  background:
                    code.length === 6 && stage !== 'verifying'
                      ? '#ffffff'
                      : 'rgba(255,255,255,0.20)',
                  color:
                    code.length === 6 && stage !== 'verifying'
                      ? '#000000'
                      : 'rgba(0,0,0,0.40)',
                  fontSize: '17px',
                  fontWeight: 700,
                  fontFamily: 'var(--font-sans)',
                  cursor:
                    code.length === 6 && stage !== 'verifying'
                      ? 'pointer'
                      : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  transition: 'background 200ms var(--ease-out)',
                }}
              >
                {stage === 'verifying' ? (
                  <>
                    <Loader2 size={20} style={{ animation: 'spin-submit 0.7s linear infinite' }} />
                    Verifying…
                  </>
                ) : (
                  'Verify code'
                )}
              </button>
            </div>

            {/* Resend */}
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <span
                onClick={resendCooldown > 0 || sendingCode ? undefined : handleResend}
                style={{
                  fontSize: '14px',
                  fontFamily: 'var(--font-sans)',
                  color:
                    resendCooldown > 0
                      ? 'rgba(255,255,255,0.30)'
                      : 'var(--accent)',
                  cursor: resendCooldown > 0 ? 'default' : 'pointer',
                }}
              >
                {sendingCode
                  ? 'Sending…'
                  : resendCooldown > 0
                    ? `Resend code in ${resendCooldown}s`
                    : "Didn't get it? Resend code"}
              </span>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin-submit { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
