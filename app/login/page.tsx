// ─── Login Screen ─────────────────────────────────────────
// Full sign-in form. Email/password + Google OAuth.
// In-component forgot-password flow (no separate page needed).
//
// States: 'login' | 'forgot' | 'sent'

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, AlertCircle, Loader2 } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import Input from '@/components/ui/Input';
import { createClient } from '@/lib/supabase';

// ── Helpers ────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Component ──────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return createClient();
  }, []);

  // ── Screen state ───────────────────────────────────────
  const [screen, setScreen] = useState<'login' | 'forgot' | 'sent'>('login');

  // ── Login form ─────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ── Forgot form ────────────────────────────────────────
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotSentTo, setForgotSentTo] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  const canLogin = isValidEmail(email) && password.length > 0 && !submitting;

  // ── Countdown ticker for resend ─────────────────────────
  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((c) => {
        if (c <= 1) { clearInterval(interval); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // ── Login handler ──────────────────────────────────────
  const handleLogin = useCallback(async () => {
    if (!canLogin || !supabase) return;
    setSubmitting(true);
    setError('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      if (signInError.message.includes('Invalid login')) {
        setError('Invalid email or password.');
      } else {
        setError(signInError.message);
      }
      setSubmitting(false);
      return;
    }

    router.replace('/');
  }, [canLogin, email, password, supabase, router]);

  // ── Google OAuth ───────────────────────────────────────
  const handleGoogleLogin = useCallback(async () => {
    if (!supabase) return;
    setSubmitting(true);
    setError('');
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/complete',
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setSubmitting(false);
    }
  }, [supabase]);

  // ── Forgot password handler ─────────────────────────────
  const handleForgotSubmit = useCallback(async () => {
    if (!isValidEmail(forgotEmail) || forgotSubmitting || !supabase) return;
    setForgotSubmitting(true);
    setError('');

    await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: window.location.origin + '/auth/reset',
    });

    setForgotSentTo(forgotEmail.trim());
    setResendCooldown(60);
    setForgotSubmitting(false);
    setScreen('sent');
  }, [forgotEmail, forgotSubmitting, supabase]);

  // ── Resend handler ─────────────────────────────────────
  const handleResend = useCallback(async () => {
    if (resendCooldown > 0 || !supabase) return;
    setForgotSubmitting(true);

    await supabase.auth.resetPasswordForEmail(forgotSentTo, {
      redirectTo: window.location.origin + '/auth/reset',
    });

    setResendCooldown(60);
    setForgotSubmitting(false);
  }, [resendCooldown, forgotSentTo, supabase]);

  // ── Enter key submit ────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (screen === 'login' && canLogin) handleLogin();
      if (screen === 'forgot') handleForgotSubmit();
    }
  };

  // ── Back navigation ────────────────────────────────────
  const handleBack = () => {
    if (screen === 'forgot' || screen === 'sent') {
      setScreen('login');
      setError('');
      setForgotEmail('');
      setForgotSentTo('');
      setResendCooldown(0);
    }
  };

  // ══════════════════════════════════════════════════════════
  //  RENDER: FORGOT PASSWORD SCREEN
  // ══════════════════════════════════════════════════════════

  if (screen === 'forgot') {
    return (
      <div
        className="bg-onboarding-reveal"
        onKeyDown={(e) => { if (e.key === 'Enter') handleForgotSubmit(); }}
        style={{
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar */}
        <div className="style-reveal-topbar">
          <button
            onClick={handleBack}
            style={{
              position: 'absolute',
              left: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
            }}
          >
            <ChevronLeft size={20} />
            Back
          </button>
          <VantageOrb size={36} animate={false} showEntrance={false} />
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '40px 24px 40px',
          }}
        >
          {/* Headline */}
          <h1 style={{ textAlign: 'center', marginBottom: '16px' }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '36px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1.1,
              }}
            >
              Forgot your
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontSize: '36px',
                fontWeight: 400,
                fontStyle: 'italic',
                color: 'var(--accent)',
                lineHeight: 1.1,
              }}
            >
              password?
            </span>
          </h1>

          {/* Subtext */}
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: '280px',
              margin: '0 auto 32px',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.5,
            }}
          >
            Enter the email you signed up with. We&apos;ll send you a reset link.
          </p>

          {/* Email Input */}
          <div style={{ width: '100%', marginBottom: '24px' }}>
            <Input
              label="EMAIL"
              type="email"
              placeholder="your@email.com"
              value={forgotEmail}
              onChange={(v) => setForgotEmail(v)}
              autoFocus
              disabled={forgotSubmitting}
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleForgotSubmit}
            disabled={!isValidEmail(forgotEmail) || forgotSubmitting}
            style={{
              width: '100%',
              height: '56px',
              borderRadius: '999px',
              border: 'none',
              background:
                isValidEmail(forgotEmail) && !forgotSubmitting
                  ? '#ffffff'
                  : 'rgba(255,255,255,0.20)',
              color:
                isValidEmail(forgotEmail) && !forgotSubmitting
                  ? '#000000'
                  : 'rgba(0,0,0,0.40)',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor:
                isValidEmail(forgotEmail) && !forgotSubmitting
                  ? 'pointer'
                  : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 200ms var(--ease-out)',
            }}
          >
            {forgotSubmitting ? (
              <>
                <Loader2 size={20} style={{ animation: 'spin 0.7s linear infinite' }} />
                Sending…
              </>
            ) : (
              'Send reset link'
            )}
          </button>

          {/* Back to sign in */}
          <button
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '13px',
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              marginTop: '24px',
              textAlign: 'center',
            }}
          >
            ← Back to sign in
          </button>
        </div>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER: SENT STATE
  // ══════════════════════════════════════════════════════════

  if (screen === 'sent') {
    return (
      <div
        className="bg-onboarding-reveal"
        style={{
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Top Bar */}
        <div className="style-reveal-topbar">
          <button
            onClick={handleBack}
            style={{
              position: 'absolute',
              left: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
            }}
          >
            <ChevronLeft size={20} />
            Back
          </button>
          <VantageOrb size={36} animate={false} showEntrance={false} />
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px 24px',
          }}
        >
          {/* Mail icon */}
          <div
            style={{
              marginBottom: '24px',
              animation: 'mail-entrance 400ms cubic-bezier(0.34,1.56,0.64,1) forwards',
            }}
          >
            <svg
              width="64"
              height="64"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M22 4L12 13L2 4" />
            </svg>
          </div>

          {/* Headline */}
          <h1 style={{ textAlign: 'center', marginBottom: '16px' }}>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-sans)',
                fontSize: '36px',
                fontWeight: 800,
                color: '#ffffff',
                lineHeight: 1.1,
              }}
            >
              Check your
            </span>
            <span
              style={{
                display: 'block',
                fontFamily: 'var(--font-serif)',
                fontSize: '36px',
                fontWeight: 400,
                fontStyle: 'italic',
                color: 'var(--accent)',
                lineHeight: 1.1,
              }}
            >
              inbox.
            </span>
          </h1>

          {/* Body */}
          <p
            style={{
              fontSize: '16px',
              color: 'var(--text-secondary)',
              textAlign: 'center',
              maxWidth: '280px',
              lineHeight: 1.6,
              fontFamily: 'var(--font-sans)',
              marginBottom: '12px',
            }}
          >
            We sent a reset link to{' '}
            <span style={{ color: 'var(--accent)' }}>{forgotSentTo}</span>.{' '}
            It expires in 60 minutes.
          </p>

          {/* Spam note */}
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              maxWidth: '260px',
              fontFamily: 'var(--font-sans)',
              marginBottom: '32px',
            }}
          >
            Don&apos;t see it? Check your spam or junk folder.
          </p>

          {/* Resend */}
          <button
            onClick={handleResend}
            disabled={resendCooldown > 0}
            style={{
              background: 'none',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '999px',
              padding: '12px 24px',
              color:
                resendCooldown > 0
                  ? 'rgba(255,255,255,0.25)'
                  : 'var(--text-secondary)',
              fontSize: '14px',
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              cursor: resendCooldown > 0 ? 'default' : 'pointer',
              transition: 'color 200ms var(--ease-out)',
            }}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend email'}
          </button>

          {/* Back to sign in */}
          <button
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '13px',
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              marginTop: '24px',
              textAlign: 'center',
            }}
          >
            ← Back to sign in
          </button>
        </div>

        <style>{`
          @keyframes mail-entrance {
            0%   { transform: scale(0); }
            50%  { transform: scale(1.1); }
            100% { transform: scale(1); }
          }
        `}</style>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════
  //  RENDER: LOGIN SCREEN (default)
  // ══════════════════════════════════════════════════════════

  return (
    <div
      className="bg-onboarding-reveal"
      onKeyDown={handleKeyDown}
      style={{
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div className="style-reveal-topbar">
        <VantageOrb size={44} animate={false} showEntrance={false} />
      </div>

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '32px 24px 40px',
        }}
      >
        {/* ── Headline ── */}
        <h1 style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '36px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.1,
            }}
          >
            Welcome
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '36px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--accent)',
              lineHeight: 1.1,
            }}
          >
            back.
          </span>
        </h1>

        {/* ── Error banner ── */}
        {error && (
          <div
            style={{
              background: 'var(--loss-10)',
              border: '1px solid var(--loss)',
              borderRadius: '12px',
              padding: '12px 16px',
              display: 'flex',
              gap: '10px',
              marginBottom: '16px',
              width: '100%',
              maxWidth: '400px',
            }}
          >
            <AlertCircle
              size={16}
              color="var(--loss)"
              style={{ flexShrink: 0, marginTop: '1px' }}
            />
            <p
              style={{
                fontSize: '14px',
                color: 'var(--text-primary)',
                margin: 0,
                lineHeight: 1.5,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {error}
            </p>
          </div>
        )}

        {/* ── Form fields ── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {/* Email */}
          <Input
            label="EMAIL"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(v) => setEmail(v)}
            disabled={submitting}
            autoFocus
          />

          {/* Password */}
          <div style={{ width: '100%' }}>
            <Input
              label="PASSWORD"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(v) => setPassword(v)}
              showToggle
              disabled={submitting}
            />

            {/* Forgot password link */}
            <div style={{ textAlign: 'right', marginTop: '6px' }}>
              <button
                onClick={() => {
                  setScreen('forgot');
                  setError('');
                  setForgotEmail(email);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Forgot password?
              </button>
            </div>
          </div>
        </div>

        {/* ── CTA section ── */}
        <div
          style={{
            marginTop: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
            maxWidth: '400px',
          }}
        >
          {/* Sign in button */}
          <button
            onClick={handleLogin}
            disabled={!canLogin}
            style={{
              width: '100%',
              height: '56px',
              borderRadius: '999px',
              border: 'none',
              background: canLogin ? '#ffffff' : 'rgba(255,255,255,0.20)',
              color: canLogin ? '#000000' : 'rgba(0,0,0,0.40)',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: canLogin ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'background 200ms var(--ease-out)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={20} style={{ animation: 'spin 0.7s linear infinite' }} />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>

          {/* Divider: or */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
            }}
          >
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'rgba(255,255,255,0.08)',
              }}
            />
            <span
              style={{
                flexShrink: 0,
                fontSize: '13px',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              or
            </span>
            <div
              style={{
                flex: 1,
                height: '1px',
                background: 'rgba(255,255,255,0.08)',
              }}
            />
          </div>

          {/* Google button */}
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
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </div>

        {/* ── Create account link ── */}
        <p
          style={{
            marginTop: '24px',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
          }}
        >
          Don&apos;t have an account?{' '}
          <span
            onClick={() => router.push('/create-account')}
            style={{
              color: 'var(--accent)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Create one
          </span>
        </p>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
