'use client';

// ─── OTP Verification Step ─────────────────────────────────
// Verification code input for email verification.
// User stays in-app, never leaves for a confirmation link.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

interface OTPVerificationProps {
  email: string;
  onSuccess: () => void;
  onBack: () => void;
}

export default function OTPVerification({ email, onSuccess, onBack }: OTPVerificationProps) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resendState, setResendState] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [resendCooldown, setResendCooldown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const otp = digits.join('');

  // Auto-focus first box on mount
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  // Resend cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // ── Handle digit input ──────────────────────────────────
  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      // Only accept single digit
      const digit = value.replace(/\D/g, '').slice(-1);
      if (!digit) return;

      setError(null);
      const newDigits = [...digits];
      newDigits[index] = digit;
      setDigits(newDigits);

      // Auto-advance to next box
      if (index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  // ── Handle backspace ────────────────────────────────────
  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        e.preventDefault();

        if (digits[index]) {
          // Clear current box
          const newDigits = [...digits];
          newDigits[index] = '';
          setDigits(newDigits);
        } else if (index > 0) {
          // Move to previous box and clear it
          const newDigits = [...digits];
          newDigits[index - 1] = '';
          setDigits(newDigits);
          inputRefs.current[index - 1]?.focus();
        }
      }
    },
    [digits],
  );

  // ── Handle paste ────────────────────────────────────────
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...digits];
    for (let i = 0; i < 6; i++) {
      newDigits[i] = pasted[i] || '';
    }
    setDigits(newDigits);
    setError(null);

    // Focus last filled box or next empty
    const focusIndex = Math.min(pasted.length, 5);
    inputRefs.current[focusIndex]?.focus();
  }, [digits]);

  // ── Verify OTP ─────────────────────────────────────────
  const handleVerify = useCallback(async () => {
    if (otp.length !== 6 || verifying) return;

    setVerifying(true);
    setError(null);

    const supabase = getSupabaseBrowserClient();

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp,
      type: 'email',
    });

    if (verifyError) {
      setVerifying(false);

      if (verifyError.message.includes('expired')) {
        setError('Code expired. Request a new one.');
      } else {
        setError('Incorrect code. Please try again.');
      }
      setDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      return;
    }

    console.log('[otp] verified, session:', data?.session?.user?.id);

    // Session is now active — proceed to post-verification flow
    onSuccess();
  }, [otp, verifying, email, onSuccess]);

  // ── Auto-submit when all digits entered ────────────────
  useEffect(() => {
    if (otp.length === 6 && !verifying) {
      // Small delay so user sees the last digit appear
      const timer = setTimeout(() => handleVerify(), 150);
      return () => clearTimeout(timer);
    }
  }, [otp, verifying, handleVerify]);

  // ── Resend OTP ─────────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (resendState !== 'idle') return;
    setResendState('loading');

    const supabase = getSupabaseBrowserClient();

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        // NO emailRedirectTo — forces OTP code, not link
      },
    });

    if (resendError) {
      setResendState('idle');
      setError('Could not resend code. Please try again.');
      return;
    }

    setResendState('sent');
    setResendCooldown(30);
    setError(null);
    setDigits(['', '', '', '', '', '']);
    inputRefs.current[0]?.focus();

    // Reset after 30s
    setTimeout(() => {
      setResendState('idle');
      setResendCooldown(0);
    }, 30000);
  }, [resendState, email]);

  const boxStyle = (index: number): React.CSSProperties => ({
    width: '48px',
    height: '56px',
    background: 'rgba(255,255,255,0.08)',
    border: `1.5px solid ${error ? 'var(--loss)' : 'rgba(255,255,255,0.15)'}`,
    borderRadius: '12px',
    fontSize: '24px',
    fontFamily: 'var(--font-sans)',
    fontWeight: 700,
    color: '#fff',
    textAlign: 'center',
    outline: 'none',
    caretColor: 'var(--accent)',
    transition: 'border-color 0.2s',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px',
        paddingTop: '0',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          width: '100%',
          height: '120px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Back button — left */}
        <button
          onClick={onBack}
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.50)',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '8px',
            fontFamily: 'var(--font-sans)',
          }}
        >
          ‹ Back
        </button>

        <VantageOrb size={100} animate showEntrance />
      </div>

      {/* ═══ HEADLINE ═══ */}
      <h1
        style={{
          marginTop: '16px',
          marginBottom: '16px',
          textAlign: 'center',
          lineHeight: 1.15,
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontSize: '32px',
            fontWeight: 800,
            color: '#ffffff',
          }}
        >
          Check your
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-serif)',
            fontSize: '32px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#ffffff',
          }}
        >
          email.
        </span>
      </h1>

      {/* ═══ SUBTEXT ═══ */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: '24px',
          lineHeight: 1.6,
        }}
      >
        <p
          style={{
            fontSize: '15px',
            color: 'rgba(255,255,255,0.60)',
            margin: 0,
            fontWeight: 400,
          }}
        >
          We sent a verification code to
        </p>
        <p
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--accent)',
            margin: '2px 0 0',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {email}
        </p>
        <p
          style={{
            fontSize: '15px',
            color: 'rgba(255,255,255,0.60)',
            margin: '0',
            fontWeight: 400,
          }}
        >
          Enter it below to verify your account.
        </p>
      </div>

      {/* ═══ OTP INPUT BOXES ═══ */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          justifyContent: 'center',
          marginBottom: '12px',
        }}
        onPaste={handlePaste}
      >
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            style={boxStyle(i)}
          />
        ))}
      </div>

      {/* ═══ ERROR ═══ */}
      {error && (
        <p
          style={{
            fontSize: '13px',
            color: 'var(--loss)',
            textAlign: 'center',
            margin: '0 0 12px',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {error}
        </p>
      )}

      {/* ═══ VERIFY BUTTON ═══ */}
      <button
        onClick={handleVerify}
        disabled={otp.length !== 6 || verifying}
        style={{
          width: '100%',
          maxWidth: '360px',
          height: '56px',
          borderRadius: '28px',
          border: 'none',
          fontSize: '16px',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          color: '#0a0a0a',
          background:
            otp.length === 6 && !verifying
              ? '#ffffff'
              : 'rgba(255,255,255,0.12)',
          cursor:
            otp.length === 6 && !verifying ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          transition: 'background 0.2s',
          marginBottom: '16px',
        }}
      >
        {verifying ? (
          <>
            <Loader2
              size={18}
              style={{ animation: 'spin 0.7s linear infinite', color: '#0a0a0a' }}
            />
            Verifying…
          </>
        ) : (
          'Verify →'
        )}
      </button>

      {/* ═══ RESEND ═══ */}
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <span
          style={{
            fontSize: '14px',
            color: 'rgba(255,255,255,0.50)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Didn&apos;t get it?{' '}
        </span>
        <button
          onClick={handleResend}
          disabled={resendState !== 'idle'}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '14px',
            fontWeight: 500,
            color:
              resendState === 'sent'
                ? 'var(--gain)'
                : 'var(--accent)',
            cursor: resendState === 'idle' ? 'pointer' : 'default',
            padding: '0',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {resendState === 'sent'
            ? `New code sent ✓ (${resendCooldown}s)`
            : resendState === 'loading'
              ? 'Sending…'
              : 'Resend code'}
        </button>
      </div>

      {/* ═══ EXPIRY NOTE ═══ */}
      <p
        style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.40)',
          textAlign: 'center',
          margin: 0,
          fontFamily: 'var(--font-sans)',
        }}
      >
        Code expires in 10 minutes.
      </p>
    </div>
  );
}
