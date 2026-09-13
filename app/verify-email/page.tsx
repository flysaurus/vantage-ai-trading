'use client';

// ─── Email Verification Page ──────────────────────────────────
// Handles both URL params (clicked from email) and manual entry.
//
// States:
//   Loading: Checking URL params
//   Ready: Form visible (pre-filled or empty)
//   Verifying: API call in progress
//   Success: Email verified, redirect countdown
//   Error: Wrong code / expired / locked out / no OTP

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, CheckCircle, XCircle, Mail } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

type VerifyState =
  | 'loading'
  | 'ready'
  | 'verifying'
  | 'success'
  | 'error';

type ErrorInfo = {
  message: string;
  code?: string;
};

// Locked light/dark system: soft top accent wash over the themed canvas
// (the wash is the --v-accent hue). Resolves per html[data-theme] — no JS.
const GRADIENT = `radial-gradient(ellipse 120% 60% at 50% -10%, rgba(14,140,153,0.10) 0%, transparent 55%), var(--v-canvas)`;

export default function VerifyEmailPage() {
  const router = useRouter();

  // ── URL params ──────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  // ── State ───────────────────────────────────────────────
  const [state, setState] = useState<VerifyState>('loading');
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [resending, setResending] = useState(false);
  const [resendToast, setResendToast] = useState<string | null>(null);
  const [successEmail, setSuccessEmail] = useState('');

  // ── Restore scrolling on standalone pages ──────────────────
  // globals.css locks body for app-shell; standalone pages need normal scroll.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('standalone-page');
    return () => { html.classList.remove('standalone-page'); };
  }, []);

  // ── Auto-verify on mount (if email + code in URL) ──────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const codeParam = params.get('code');

    if (emailParam) setEmail(decodeURIComponent(emailParam));
    if (codeParam) setCode(codeParam);

    if (emailParam && codeParam) {
      setPrefilled(true);
      const emailToVerify = decodeURIComponent(emailParam);
      const codeToVerify = codeParam;

      if (emailToVerify && codeToVerify.length === 6) {
        setState('verifying');
        setError(null);

        // Inline the auto-verify logic (no external deps)
        fetch('/api/auth/verify-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: emailToVerify, code: codeToVerify }),
        })
          .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
          .then(({ ok, data }) => {
            if (ok && data.success) {
              setSuccessEmail(emailToVerify);
              setState('success');
            } else {
              setState('error');
              setError({
                message: data.error || 'Verification failed',
                code: data.code,
              });
            }
          })
          .catch(() => {
            setState('error');
            setError({ message: 'Network error. Please try again.' });
          });
      }
    } else {
      setState('ready');
    }
  }, []);

  // ── Verify OTP ──────────────────────────────────────────
  const verifyOtp = async (emailToVerify: string, codeToVerify: string) => {
    if (!emailToVerify || codeToVerify.length !== 6) return;

    setState('verifying');
    setError(null);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToVerify, code: codeToVerify }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setSuccessEmail(emailToVerify);
        setState('success');
      } else {
        setState('error');
        setError({
          message: data.error || 'Verification failed',
          code: data.code,
        });
      }
    } catch {
      setState('error');
      setError({ message: 'Network error. Please try again.' });
    }
  };

  // ── Manual verify (user typed email + code) ─────────────
  const handleSubmit = useCallback(() => {
    if (!email || code.length !== 6) return;
    verifyOtp(email, code);
  }, [email, code]);

  // ── Resend OTP ──────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (!email) return;
    setResending(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.ok) {
        setCode(''); // Clear old code
        setState('ready');
        setResendToast('New code sent! Check your email.');
        setTimeout(() => setResendToast(null), 4000);
      } else {
        setError({ message: data.error || 'Failed to resend' });
      }
    } catch {
      setError({ message: 'Network error. Please try again.' });
    } finally {
      setResending(false);
    }
  }, [email]);

  // ── Handle keydown ──────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  // ── Handle code input: digits only, max 6 ───────────────
  const handleCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (error) setError(null);
  };

  // ── Gradient background (shared with other onboarding pages) ──
  const pageStyle: React.CSSProperties = {
    minHeight: '100dvh',
    background: GRADIENT,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: 'var(--v-text-primary)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  };

  const contentStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '60px 24px 40px',
    width: '100%',
    maxWidth: '400px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--v-card)',
    border: '1px solid var(--v-card-border)',
    boxShadow: 'var(--v-shadow-card)',
    borderRadius: '10px',
    padding: '14px 16px',
    color: 'var(--v-text-primary)',
    fontSize: '16px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    background: '#06b6d4',
    color: '#0a0f1e',
    border: 'none',
    borderRadius: '10px',
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '16px',
  };

  const buttonDisabledStyle: React.CSSProperties = {
    ...buttonStyle,
    opacity: 0.5,
    cursor: 'not-allowed',
  };

  // ── Code input (large, centered, monospace) ─────────────
  const codeInputStyle: React.CSSProperties = {
    ...inputStyle,
    textAlign: 'center',
    fontSize: '32px',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: '12px',
    padding: '18px 16px',
    maxWidth: '280px',
  };

  // ── RENDER: Loading ─────────────────────────────────────
  if (state === 'loading') {
    return (
      <div className="auth-shell" style={pageStyle}>
        <div style={contentStyle}>
          <Loader2 size={32} color="var(--v-accent)" style={{ animation: 'spin 1s linear infinite', marginTop: '80px' }} />
        </div>
      </div>
    );
  }

  // ── RENDER: Success ─────────────────────────────────────
  if (state === 'success') {
    return (
      <div className="auth-shell" style={pageStyle}>
        <div style={contentStyle}>
          <div style={{ marginTop: '80px', textAlign: 'center' }}>
            <CheckCircle size={64} color="var(--v-gain)" />
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '24px 0 8px', color: 'var(--v-text-primary)' }}>
              Email verified!
            </h1>
            <p style={{ fontSize: '14px', color: 'var(--v-text-secondary)', lineHeight: 1.6, margin: '0 0 32px' }}>
              Your email <strong style={{ color: 'var(--v-text-primary)' }}>{successEmail}</strong> is verified.
              Sign in to continue setting up your account.
            </p>
            <button
              style={buttonStyle}
              onClick={() => router.push('/login')}
            >
              Continue to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: Main form ───────────────────────────────────

  const canSubmit =
    email.includes('@') &&
    code.length === 6 &&
    state !== 'verifying';

  const isExpired = error?.code === 'EXPIRED';
  const isLocked = error?.code === 'LOCKED_OUT';
  const isWrong = error?.code === 'WRONG_CODE';
  const isNoOtp = error?.code === 'NO_OTP';

  return (
    <div className="auth-shell" style={pageStyle}>
      {/* Top bar */}
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          onClick={() => router.push('/create-account')}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v-text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '14px',
            padding: 0,
          }}
        >
          <ArrowLeft size={18} />
          Back
        </button>
        <VantageOrb size={32} />
      </div>

      <div style={contentStyle}>
        {/* Header */}
        <Mail size={48} color="var(--v-accent)" style={{ marginBottom: '24px' }} />

        {/* Context badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--v-accent-dim)',
            border: '1px solid var(--v-accent-label)',
            borderRadius: '20px',
            padding: '4px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--v-accent-label)',
            letterSpacing: '0.04em',
          }}
        >
          🔐 ACCOUNT SETUP
        </div>

        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            margin: '0 0 8px',
            textAlign: 'center',
            color: 'var(--v-text-primary)',
          }}
        >
          Verify your account
        </h1>

        <p
          style={{
            fontSize: '14px',
            color: 'var(--v-text-secondary)',
            textAlign: 'center',
            margin: '0 0 8px',
            lineHeight: 1.6,
          }}
        >
          Enter the 6-digit code from your signup email.
        </p>

        <p
          style={{
            fontSize: '12px',
            color: 'var(--v-text-secondary)',
            textAlign: 'center',
            margin: '0 0 32px',
            lineHeight: 1.5,
          }}
        >
          This is <strong style={{ color: 'var(--v-text-primary)' }}>not</strong> a sign-in code. If you&apos;re trying to log in, go to the{' '}
          <a href="/login" style={{ color: 'var(--v-accent-label)', textDecoration: 'underline' }}>sign-in page</a>.
        </p>

        {/* Email field (editable if not pre-filled from URL) */}
        <div style={{ width: '100%', marginBottom: '16px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--v-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '6px',
              display: 'block',
            }}
          >
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setPrefilled(false);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="you@example.com"
            style={inputStyle}
            disabled={state === 'verifying'}
          />
        </div>

        {/* Code field */}
        <div style={{ width: '100%', marginBottom: '8px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--v-text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '6px',
              display: 'block',
            }}
          >
            Code from signup email
          </label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="000000"
            style={codeInputStyle}
            disabled={state === 'verifying'}
            autoFocus={prefilled}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div
            style={{
              width: '100%',
              background: isExpired || isLocked
                ? 'var(--v-warn-dim)'
                : 'var(--v-loss-dim)',
              border: `1px solid ${isExpired || isLocked ? 'var(--v-warn)' : 'var(--v-loss-label)'}`,
              borderRadius: '10px',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '10px',
              marginTop: '8px',
            }}
          >
            <XCircle
              size={16}
              color={isExpired || isLocked ? 'var(--v-warn)' : 'var(--v-loss-label)'}
              style={{ flexShrink: 0, marginTop: '2px' }}
            />
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--v-text-primary)',
                  margin: 0,
                  lineHeight: 1.5,
                }}
              >
                {error.message}
              </p>
              {(isExpired || isLocked || isWrong || isNoOtp) && (
                <button
                  onClick={handleResend}
                  disabled={resending}
                  style={{
                    marginTop: '10px',
                    background: 'transparent',
                    border: '1px solid var(--v-accent-label)',
                    color: 'var(--v-accent-label)',
                    borderRadius: '8px',
                    padding: '6px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: resending ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {resending && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
                  {resending ? 'Sending...' : 'Resend code'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Submit button */}
        <button
          style={canSubmit ? buttonStyle : buttonDisabledStyle}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {state === 'verifying' ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              Verifying...
            </span>
          ) : (
            'Verify email'
          )}
        </button>

        {/* Resend (always visible, not just on error) */}
        <button
          onClick={handleResend}
          disabled={resending}
          style={{
            marginTop: '12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--v-accent-label)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: resending ? 'wait' : 'pointer',
            textDecoration: 'underline',
          }}
        >
          {resending ? 'Sending...' : "Didn't receive a code? Resend"}
        </button>
      </div>

      {/* Toast */}
      {resendToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '32px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--v-card)',
            border: '1px solid var(--v-accent)',
            borderRadius: '12px',
            padding: '12px 24px',
            color: 'var(--v-text-primary)',
            fontSize: '14px',
            fontWeight: 600,
            boxShadow: 'var(--v-shadow-toast)',
            zIndex: 99999,
          }}
        >
          {resendToast}
        </div>
      )}
    </div>
  );
}
