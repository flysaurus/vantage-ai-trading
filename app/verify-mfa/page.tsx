'use client';

// ─── MFA Verification Page ──────────────────────────────────
// Shown after password login when user has MFA enabled.
// Handles: TOTP code, Email OTP, Backup codes.
//
// States:
//  - totp: Prompt for authenticator app code + backup code toggle
//  - email: Code emailed automatically, prompt for entry
//  - loading: Checking MFA status
//  - success: MFA passed, redirecting

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield, Smartphone, Mail, ChevronRight } from 'lucide-react';

type MfaStep = 'loading' | 'code-entry' | 'verifying' | 'success';

// ── Gradient ───────────────────────────────────────────────

// Locked light/dark system: soft top accent wash over the themed canvas
// (the wash is the --v-accent hue). Resolves per html[data-theme] — no JS.
const GRADIENT = `radial-gradient(ellipse 120% 60% at 50% -10%, rgba(14,140,153,0.10) 0%, transparent 55%), var(--v-canvas)`;

export default function VerifyMfaPage() {
  const router = useRouter();

  const [step, setStep] = useState<MfaStep>('loading');
  const [mfaMethod, setMfaMethod] = useState<'totp' | 'email' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  // ── Check MFA status on mount ─────────────────────────
  useEffect(() => {
    const checkMfa = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (!res.ok) {
          router.push('/login');
          return;
        }
        const { user } = await res.json();

        if (user.mfa_enabled === false || user.mfa_enabled === undefined) {
          // Not set up yet or columns missing — redirect to setup
          router.push('/setup-mfa');
          return;
        }

        if (!user.mfa_method) {
          setError('MFA method not configured. Please set up 2FA again.');
          return;
        }

        // Got the real method from the DB
        setMfaMethod(user.mfa_method);
        setStep('code-entry');

        // Auto-send email OTP if email method
        if (user.mfa_method === 'email') {
          handleSendEmailOtp();
        }
      } catch {
        setError('Network error. Please refresh.');
      }
    };
    checkMfa();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send email OTP ────────────────────────────────────
  const handleSendEmailOtp = useCallback(async () => {
    if (resending) return;
    setResending(true);
    setResent(false);
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }), // email is looked up from session
      });
      const data = await res.json();
      if (res.ok) {
        setResent(true);
      } else if (data.error?.includes('Please wait')) {
        // Rate limited
        setError('Please wait before requesting another code.');
      } else {
        setError(data.error || 'Failed to send code');
      }
    } catch {
      setError('Network error.');
    } finally {
      setResending(false);
    }
  }, [resending]);

  // ── Verify code ───────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (code.length < 6 && !useBackupCode) return;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), isBackupCode: useBackupCode }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setStep('success');
        // Redirect after brief delay
        setTimeout(() => {
          window.location.href = '/';
        }, 800);
      } else {
        setError(data.error || 'Verification failed');
        setErrorCode(data.code || null);
        setCode('');

        if (data.used_backup_code) {
          setError('This is a used backup code. Enter another one.');
        }
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [code, useBackupCode]);

  // ── Handle keydown ────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleVerify();
  };

  // ── Styles ───────────────────────────────────────────
  const pageStyle: React.CSSProperties = {
    minHeight: '100dvh',
    background: GRADIENT,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    color: 'var(--v-text-primary)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    padding: '80px 24px 40px',
  };

  const codeInputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--v-card)',
    border: '1px solid var(--v-card-border)',
    boxShadow: 'var(--v-shadow-card)',
    borderRadius: '10px',
    padding: '18px 16px',
    color: 'var(--v-text-primary)',
    fontSize: '32px',
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    letterSpacing: '12px',
    textAlign: 'center',
    outline: 'none',
    boxSizing: 'border-box',
    maxWidth: '280px',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--v-accent-button)',
    color: 'var(--v-accent-text)',
    border: 'none',
    borderRadius: '10px',
    padding: '14px 24px',
    fontSize: '16px',
    fontWeight: 700,
    cursor: 'pointer',
    maxWidth: '280px',
  };

  // ── RENDER: Loading ───────────────────────────────────
  if (step === 'loading') {
    return (
      <div style={pageStyle}>
        <Loader2 size={32} color="var(--v-accent)" style={{ animation: 'spin 1s linear infinite', marginTop: '80px' }} />
      </div>
    );
  }

  // ── RENDER: Success ───────────────────────────────────
  if (step === 'success') {
    return (
      <div style={pageStyle}>
        <Shield size={64} color="var(--v-gain)" style={{ marginBottom: '24px' }} />
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: 'var(--v-text-primary)', textAlign: 'center' }}>
          Verified
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--v-text-secondary)', textAlign: 'center', margin: '0 0 24px' }}>
          Redirecting...
        </p>
        <Loader2 size={24} color="var(--v-accent)" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // ── RENDER: Code entry ───────────────────────────────
  const isTotp = mfaMethod === 'totp';
  const isExpired = errorCode === 'EXPIRED';
  const isLocked = errorCode === 'LOCKED_OUT';
  const isWrong = errorCode === 'WRONG_CODE';

  return (
    <div className="auth-shell" style={pageStyle}>
      <Shield size={48} color="var(--v-accent)" style={{ marginBottom: '24px' }} />

      <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 8px', color: 'var(--v-text-primary)', textAlign: 'center' }}>
        {useBackupCode ? 'Enter backup code' : 'Verify your identity'}
      </h1>

      <p style={{ fontSize: '14px', color: 'var(--v-text-secondary)', textAlign: 'center', margin: '0 0 32px', lineHeight: 1.6, maxWidth: '360px' }}>
        {useBackupCode
          ? 'Enter one of your saved backup codes to sign in.'
          : isTotp
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Enter the 6-digit code we sent to your email.'}
      </p>

      {/* Code input */}
      <input
        type={useBackupCode ? 'text' : 'text'}
        inputMode={useBackupCode ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        value={code}
        onChange={(e) => {
          if (useBackupCode) {
            setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12));
          } else {
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
          }
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={useBackupCode ? 'XXXXXXXXXXXX' : '000000'}
        style={{
          ...codeInputStyle,
          letterSpacing: useBackupCode ? '2px' : '12px',
          fontSize: useBackupCode ? '16px' : '32px',
        }}
        disabled={loading}
        autoFocus
      />

      {/* Error banner */}
      {error && (
        <div style={{
          width: '100%',
          maxWidth: '280px',
          marginTop: '12px',
          background: isExpired || isLocked
            ? 'var(--v-warn-dim)'
            : 'var(--v-loss-dim)',
          border: `1px solid ${isExpired || isLocked ? 'var(--v-warn)' : 'var(--v-loss-label)'}`,
          borderRadius: '10px',
          padding: '12px 16px',
          color: 'var(--v-text-primary)',
          fontSize: '13px',
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}

      {/* Verify button */}
      <button
        style={{
          ...buttonStyle,
          marginTop: '16px',
          opacity: (code.length >= 6 || useBackupCode) && !loading ? 1 : 0.5,
          cursor: (code.length >= 6 || useBackupCode) && !loading ? 'pointer' : 'not-allowed',
        }}
        disabled={(code.length < 6 && !useBackupCode) || loading}
        onClick={handleVerify}
      >
        {loading ? (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            Verifying...
          </span>
        ) : (
          'Verify'
        )}
      </button>

      {/* Email OTP resend */}
      {isTotp && !useBackupCode && (
        <button
          onClick={() => setUseBackupCode(true)}
          style={{
            marginTop: '16px',
            background: 'transparent',
            border: 'none',
            color: 'var(--v-accent-label)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Use a backup code instead
        </button>
      )}

      {useBackupCode && (
        <button
          onClick={() => {
            setUseBackupCode(false);
            setCode('');
            setError(null);
          }}
          style={{
            marginTop: '12px',
            background: 'transparent',
            border: 'none',
            color: 'var(--v-accent-label)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
        >
          Use authenticator app instead
        </button>
      )}

      {mfaMethod === 'email' && (
        <button
          onClick={handleSendEmailOtp}
          disabled={resending}
          style={{
            marginTop: '16px',
            background: 'transparent',
            border: 'none',
            color: resending ? 'var(--v-text-secondary)' : 'var(--v-accent)',
            fontSize: '14px',
            fontWeight: 600,
            cursor: resending ? 'wait' : 'pointer',
            textDecoration: 'underline',
          }}
        >
          {resending ? 'Sending...' : resent ? 'Code sent! Resend?' : "Didn't receive a code? Resend"}
        </button>
      )}
    </div>
  );
}
