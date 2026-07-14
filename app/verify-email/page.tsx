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

  // ── Parse URL params on mount ───────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const emailParam = params.get('email');
    const codeParam = params.get('code');

    if (emailParam) setEmail(decodeURIComponent(emailParam));
    if (codeParam) setCode(codeParam);

    if (emailParam && codeParam) {
      setPrefilled(true);
      // Auto-verify if pre-filled from email link
      verifyOtp(decodeURIComponent(emailParam), codeParam);
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
    background: 'linear-gradient(180deg, #0b0f1d 0%, #131a2e 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: '#e2e8f0',
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
    background: '#1a1f35',
    border: '1px solid #2d3550',
    borderRadius: '10px',
    padding: '14px 16px',
    color: '#f8fafc',
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
      <div style={pageStyle}>
        <div style={contentStyle}>
          <Loader2 size={32} color="#06b6d4" style={{ animation: 'spin 1s linear infinite', marginTop: '80px' }} />
        </div>
      </div>
    );
  }

  // ── RENDER: Success ─────────────────────────────────────
  if (state === 'success') {
    return (
      <div style={pageStyle}>
        <div style={contentStyle}>
          <div style={{ marginTop: '80px', textAlign: 'center' }}>
            <CheckCircle size={64} color="#22c55e" />
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '24px 0 8px', color: '#f8fafc' }}>
              Email verified!
            </h1>
            <p style={{ fontSize: '14px', color: '#94a3b8', lineHeight: 1.6, margin: '0 0 32px' }}>
              Your email <strong style={{ color: '#e2e8f0' }}>{successEmail}</strong> is verified.
              You can now sign in.
            </p>
            <button
              style={buttonStyle}
              onClick={() => router.push('/setup-mfa')}
            >
              Continue to Vantage
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
    <div style={pageStyle}>
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
            color: '#94a3b8',
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
        <Mail size={48} color="#06b6d4" style={{ marginBottom: '24px' }} />

        {/* Context badge */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: 'rgba(6,182,212,0.12)',
            border: '1px solid rgba(6,182,212,0.25)',
            borderRadius: '20px',
            padding: '4px 14px',
            marginBottom: '16px',
            fontSize: '12px',
            fontWeight: 600,
            color: '#06b6d4',
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
            color: '#f8fafc',
          }}
        >
          Verify your account
        </h1>

        <p
          style={{
            fontSize: '14px',
            color: '#94a3b8',
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
            color: 'rgba(255,255,255,0.35)',
            textAlign: 'center',
            margin: '0 0 32px',
            lineHeight: 1.5,
          }}
        >
          This is <strong style={{ color: 'rgba(255,255,255,0.5)' }}>not</strong> a sign-in code. If you&apos;re trying to log in, go to the{' '}
          <a href="/login" style={{ color: '#06b6d4', textDecoration: 'underline' }}>sign-in page</a>.
        </p>

        {/* Email field (editable if not pre-filled from URL) */}
        <div style={{ width: '100%', marginBottom: '16px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#94a3b8',
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
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="you@example.com"
            style={inputStyle}
            disabled={prefilled || state === 'verifying'}
          />
        </div>

        {/* Code field */}
        <div style={{ width: '100%', marginBottom: '8px' }}>
          <label
            style={{
              fontSize: '12px',
              fontWeight: 600,
              color: '#94a3b8',
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
                ? 'rgba(210,153,34,0.1)'
                : 'rgba(218,54,51,0.1)',
              border: `1px solid ${isExpired || isLocked ? '#d29922' : '#da3633'}`,
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
              color={isExpired || isLocked ? '#d29922' : '#da3633'}
              style={{ flexShrink: 0, marginTop: '2px' }}
            />
            <div style={{ flex: 1 }}>
              <p
                style={{
                  fontSize: '13px',
                  color: '#e6edf3',
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
                    border: '1px solid #06b6d4',
                    color: '#06b6d4',
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
            color: '#06b6d4',
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
            background: '#161b22',
            border: '1px solid #06b6d4',
            borderRadius: '12px',
            padding: '12px 24px',
            color: '#f8fafc',
            fontSize: '14px',
            fontWeight: 600,
            zIndex: 99999,
          }}
        >
          {resendToast}
        </div>
      )}
    </div>
  );
}
