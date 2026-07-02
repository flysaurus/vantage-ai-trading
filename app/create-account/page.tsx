// ─── Create Account Screen ──────────────────────────────────
// Full signup form. Receives firstName, lastName, investorStyle,
// and riskTolerance from OnboardingFlow via sessionStorage.
//
// Layout:
//   Natural scroll flow (no sticky):
//     Top bar (back arrow + VantageOrb)
//     Headline (two-line)
//     Investor style summary card (emoji + style + risk + Change)
//     Error banner (conditional, on API error)
//     Google sign-in button
//     OR divider
//     Form fields (first, last, email, password, confirm)
//     Terms text
//     Create Account button
//     Sign in link

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  Info,
} from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import OTPVerification from '@/components/onboarding/OTPVerification';
import Input from '@/components/ui/Input';
import PasswordStrength from '@/components/ui/PasswordStrength';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';
import {
  getStyleContent,
  getStyleEmoji,
} from '@/lib/content/investor-styles';
import { RISK_COLORS, RISK_LABELS } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// ── Helpers ──────────────────────────────────────────────────

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Props (from sessionStorage) ──────────────────────────────

interface OnboardingData {
  style: InvestorStyleKey;
  risk: RiskTolerance;
  firstName: string;
  lastName: string;
}

function readOnboardingData(): OnboardingData | null {
  try {
    // Try the old key first (set by legacy OnboardingFlow or standalone onboarding page)
    let raw = sessionStorage.getItem('vantage_onboarding_data');
    if (!raw) {
      // Fall back to the new 4B-1 key (set by OnboardingFlow component)
      raw = sessionStorage.getItem('vantage_onboarding');
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // If it's the new format (has currentStep), map field names
    if (parsed.currentStep !== undefined) {
      return {
        style: parsed.investorStyle || null,
        risk: parsed.riskTolerance || null,
        firstName: parsed.firstName ?? '',
        lastName: parsed.lastName ?? '',
      } as OnboardingData;
    }

    // Old format: { style, risk, firstName, lastName }
    return parsed as OnboardingData;
  } catch {
    return null;
  }
}

// ── Step type ──────────────────────────────────────────────

type CreateAccountStep = 'form' | 'verify-otp' | 'check-email';

export default function CreateAccountPage() {
  const router = useRouter();

  // ── Onboarding data ──────────────────────────────────────
  const [onboardingData] = useState<OnboardingData | null>(() => readOnboardingData());

  // ── Form state ───────────────────────────────────────────
  const [firstName, setFirstName] = useState(onboardingData?.firstName ?? '');
  const [lastName, setLastName] = useState(onboardingData?.lastName ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // ── Step state ───────────────────────────────────────────
  const [step, setStep] = useState<CreateAccountStep>('form');

  // ── Pending choice from OnboardingFlow ───────────────────
  const pendingChoice = onboardingData ? (
    (() => {
      try {
        const raw = sessionStorage.getItem('vantage_onboarding');
        if (raw) return JSON.parse(raw).pendingChoice ?? null;
      } catch {}
      return null;
    })()
  ) : null;

  const pendingConnectionType = onboardingData ? (
    (() => {
      try {
        const raw = sessionStorage.getItem('vantage_onboarding');
        if (raw) return JSON.parse(raw).pendingConnectionType ?? null;
      } catch {}
      return null;
    })()
  ) : null;

  // ── Validation state ─────────────────────────────────────
  const [emailError, setEmailError] = useState('');
  const [emailDuplicate, setEmailDuplicate] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [confirmResendState, setConfirmResendState] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [confirmResendCooldown, setConfirmResendCooldown] = useState(0);
  const [emailTouched, setEmailTouched] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);

  // ── API state ────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');

  // ── Computed ─────────────────────────────────────────────
  const style = onboardingData?.style || 'buffett';
  const risk = onboardingData?.risk || 'moderate';
  const styleContent = getStyleContent(style);
  const styleEmoji = getStyleEmoji(style);
  const shortLabel = styleContent.shortLabel;
  const riskColor = RISK_COLORS[risk];
  const riskLabel = RISK_LABELS[risk];

  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const showMatchIndicator = confirmTouched && confirmPassword.length > 0;

  // Password strength requirements
  const passwordMet = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password),
    /[!@#$%^&*]/.test(password),
  ];
  const allPasswordReqsMet = passwordMet.every(Boolean);

  // Form validity
  const canSubmit =
    !!firstName.trim() &&
    !!lastName.trim() &&
    isValidEmail(email) &&
    emailError === '' &&
    !emailDuplicate &&
    !showResendConfirmation &&
    allPasswordReqsMet &&
    password === confirmPassword &&
    confirmPassword.length > 0 &&
    !submitting;

  // ── Redirect if no onboarding data ──────────────────────
  useEffect(() => {
    if (!onboardingData) {
      router.replace('/onboarding');
    }
  }, [onboardingData, router]);

  if (!onboardingData) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          background: '#0a0f1e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Loader2
          size={24}
          color="var(--accent)"
          style={{ animation: 'spin 0.7s linear infinite' }}
        />
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────

  const handleBack = () => {
    try {
      const raw = sessionStorage.getItem('vantage_onboarding');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.pendingChoice === 'broker') {
          data.currentStep = 'connection-options';
        } else {
          data.currentStep = 'broker-choice';
        }
        sessionStorage.setItem('vantage_onboarding', JSON.stringify(data));
      }
    } catch {}
    router.back();
  };

  const handleChange = () => {
    try {
      sessionStorage.setItem('vantage_onboarding_retake', 'reveal');
    } catch {}
    router.push('/onboarding');
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);
    if (email.length > 0 && !isValidEmail(email)) {
      setEmailError('Enter a valid email address');
    } else {
      setEmailError('');
    }
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    setEmailDuplicate(false);
    setShowResendConfirmation(false);
    if (emailTouched && value.length > 0 && !isValidEmail(value)) {
      setEmailError('Enter a valid email address');
    } else {
      setEmailError('');
    }
  };

  const resendConfirmation = useCallback(async () => {
    if (confirmResendState !== 'idle') return;
    setConfirmResendState('loading');

    try {
      const { getSupabaseBrowserClient } = await import('@/lib/auth/supabase-client');
      const supabase = getSupabaseBrowserClient();

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: {
          emailRedirectTo: 'https://vantage-ai-trading.vercel.app/auth/complete',
        },
      });

      if (error) {
        setConfirmResendState('idle');
        setApiError('Could not resend. Try again.');
        return;
      }
    } catch {
      setConfirmResendState('idle');
      setApiError('Could not resend. Try again.');
      return;
    }

    // Show success state — disabled for 30s
    setConfirmResendState('sent');
    setConfirmResendCooldown(30);

    // Reset after 30s
    setTimeout(() => {
      setConfirmResendState('idle');
      setConfirmResendCooldown(0);
    }, 30000);
  }, [confirmResendState, email]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    setApiError('');
    setEmailError('');
    setEmailDuplicate(false);

    // ── Pre-flight: check if email already registered ────
    try {
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const { exists, confirmed } = await checkRes.json();

      if (exists) {
        if (confirmed) {
          // Case 1: Fully confirmed account — show sign-in link
          setEmailDuplicate(true);
        } else {
          // Case 2: Unconfirmed — show resend confirmation UI
          setShowResendConfirmation(true);
        }
        setSubmitting(false);
        return;
      }
    } catch {
      // Fail open — proceed with signUp if check-email is down
    }

    // Call server-side signup route (admin API for 6-digit OTP)
    const signupRes = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        investor_style: style,
        risk_tolerance: risk,
        pending_choice: pendingChoice,
        pending_connection_type: pendingConnectionType ?? null,
      }),
    });

    const signupData: { success?: boolean; error?: string; user_id?: string } =
      await signupRes.json();

    if (!signupRes.ok) {
      setSubmitting(false);

      if (signupData.error === 'duplicate_email') {
        setEmailDuplicate(true);
        return;
      }

      setApiError(
        signupData.error ?? 'Signup failed. Please try again.',
      );
      return;
    }

    console.log('[signup] server-side user created:', signupData.user_id);

    // Advance to OTP verification screen
    setStep('verify-otp');
    setSubmitting(false);
  }, [canSubmit, email, password, firstName, lastName, style, risk, pendingChoice, pendingConnectionType]);

  // ── OTP verification success ────────────────────────────
  const handleOTPSuccess = useCallback(async () => {
    setSubmitting(true);

    try {
      // Run user setup server-side
      await fetch('/api/user/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          investor_style: style,
          risk_tolerance: risk,
        }),
      });

      // Start demo or broker flow
      if (pendingChoice === 'demo') {
        await fetch('/api/demo/start', {
          method: 'POST',
          credentials: 'include',
        });
      } else if (pendingChoice === 'broker') {
        await fetch('/api/connections/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            connection_type: pendingConnectionType,
          }),
        });
      }

      // Clear onboarding sessionStorage
      try {
        sessionStorage.removeItem('vantage_onboarding_data');
        sessionStorage.removeItem('vantage_onboarding');
      } catch {}

      // Navigate — session is already active from verifyOtp()
      router.push('/you-are-in');
    } catch (err) {
      console.error('[otp] setup failed:', err);
      setApiError('Something went wrong. Please try again.');
    }

    setSubmitting(false);
  }, [firstName, lastName, style, risk, pendingChoice, pendingConnectionType, router]);

  // ── Google sign-up ───────────────────────────────────────
  const handleGoogleSignUp = useCallback(async () => {
    setSubmitting(true);
    setApiError('');

    try {
      const supabase = getSupabaseBrowserClient();
      const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
      const redirectTo = `${appUrl}/auth/complete`;

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            investor_style: style,
            risk_tolerance: risk,
            pending_choice: pendingChoice ?? '',
            pending_connection_type: pendingConnectionType ?? '',
          },
        },
      });

      if (error) {
        setApiError('Google sign-in coming soon. Please use email for now.');
        setSubmitting(false);
        return;
      }
      // Page will redirect — no need to reset state
    } catch {
      setApiError('Google sign-in coming soon. Please use email for now.');
      setSubmitting(false);
    }
  }, [style, risk, pendingChoice, pendingConnectionType]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit) {
      handleSubmit();
    }
  };

  // ── Render error banner ──────────────────────────────────

  const errorBanner = apiError ? (
    <div
      style={{
        background: 'var(--loss-10)',
        border: '1px solid var(--loss)',
        borderRadius: '12px',
        padding: '12px 16px',
        display: 'flex',
        gap: '10px',
        marginBottom: '16px',
      }}
    >
      <AlertCircle size={16} color="var(--loss)" style={{ flexShrink: 0, marginTop: '1px' }} />
      <p style={{ fontSize: '14px', color: 'var(--text-primary)', margin: 0, lineHeight: 1.5 }}>
        {apiError.includes('Sign in instead') ? (
          <>
            An account with this email already exists.{' '}
            <span
              onClick={() => router.push('/login')}
              style={{
                color: 'var(--accent)',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              Sign in instead.
            </span>
          </>
        ) : (
          apiError
        )}
      </p>
    </div>
  ) : null;

  // ── Verify OTP view ──────────────────────────────────────
  if (step === 'verify-otp') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100dvh',
          background: '#0a0f1e',
          color: '#fff',
          fontFamily: 'var(--font-sans)',
          alignItems: 'center',
          padding: '24px',
        }}
      >
        <OTPVerification
          email={email}
          onSuccess={handleOTPSuccess}
          onBack={() => setStep('form')}
        />
      </div>
    );
  }

  // ── Check-email view (after successful signUp) ───────────
  if (step === 'check-email') {
    return (
      <CheckEmailView
        email={email}
        onSignIn={() => router.push('/login')}
      />
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div
      className="bg-onboarding-reveal"
      onKeyDown={handleKeyDown}
      style={{
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 24px 40px',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'transparent',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <button
          onClick={handleBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            color: 'var(--text-secondary)',
          }}
        >
          <ChevronLeft size={20} />
          <span style={{ fontSize: '15px', fontFamily: 'var(--font-sans)' }}>Back</span>
        </button>

        <VantageOrb size={36} animate={false} showEntrance={false} />
      </div>

      {/* ═══ HEADLINE ═══ */}
      <h1 style={{ marginTop: '24px', marginBottom: '6px', textAlign: 'center' }}>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontSize: '32px',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.1,
          }}
        >
          Lock in your
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-serif)',
            fontSize: '32px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: '#ffffff',
            lineHeight: 1.1,
          }}
        >
          investor identity.
        </span>
      </h1>

      {/* ═══ PROFILE SUMMARY CARD ═══ */}
      <div
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px',
          padding: '14px 16px',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {/* Emoji + style name */}
        <span style={{ fontSize: '28px', lineHeight: 1 }}>{styleEmoji}</span>
        <span
          style={{
            fontSize: '15px',
            fontWeight: 600,
            color: '#ffffff',
            fontFamily: 'var(--font-sans)',
          }}
        >
          {shortLabel}
        </span>

        {/* Separator */}
        <span style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '0 2px' }}>
          ·
        </span>

        {/* Risk badge */}
        <span
          style={{
            background: 'transparent',
            border: `1px solid ${riskColor}`,
            borderRadius: '999px',
            padding: '3px 10px',
            fontSize: '12px',
            fontWeight: 600,
            color: riskColor,
            fontFamily: 'var(--font-sans)',
            whiteSpace: 'nowrap',
          }}
        >
          {riskLabel} Risk
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Change */}
        <button
          onClick={handleChange}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            fontSize: '12px',
            fontFamily: 'var(--font-sans)',
            cursor: 'pointer',
            padding: 0,
            whiteSpace: 'nowrap',
          }}
        >
          Change ›
        </button>
      </div>

      {/* ═══ ERROR BANNER ═══ */}
      {errorBanner}

      {/* ═══ GOOGLE SIGN-IN ═══ */}
      <button
        onClick={handleGoogleSignUp}
        disabled={submitting}
        style={{
          width: '100%',
          height: '64px',
          borderRadius: '999px',
          border: 'none',
          background: '#ffffff',
          color: '#000000',
          fontSize: '17px',
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          letterSpacing: '-0.2px',
          cursor: submitting ? 'default' : 'pointer',
          opacity: submitting ? 0.4 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          marginBottom: '12px',
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

      {/* ═══ OR DIVIDER ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '100%',
          gap: '12px',
          marginBottom: '12px',
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
            fontSize: '12px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.30)',
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

      {/* ═══ FORM FIELDS ═══ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {/* First Name */}
        <Input
          label="FIRST NAME"
          placeholder="First name"
          value={firstName}
          onChange={(v) => setFirstName(v)}
          disabled={submitting}
        />

        {/* Last Name */}
        <Input
          label="LAST NAME"
          placeholder="Last name"
          value={lastName}
          onChange={(v) => setLastName(v)}
          disabled={submitting}
        />

        {/* Email */}
        <Input
          label="EMAIL"
          placeholder="your@email.com"
          type="email"
          value={email}
          onChange={handleEmailChange}
          onBlur={handleEmailBlur}
          error={emailDuplicate ? '' : emailError}
          disabled={submitting}
        />

        {/* Confirmed account exists */}
        {emailDuplicate && (
          <div style={{ marginTop: '4px' }}>
            <p
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: 'var(--loss)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 4px',
                lineHeight: 1.4,
              }}
            >
              An account with this email already exists.
            </p>
            <span
              onClick={() => router.push('/login')}
              style={{
                color: 'var(--accent)',
                fontSize: '12px',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
              }}
            >
              Sign in instead →
            </span>
          </div>
        )}

        {/* Unconfirmed account — resend confirmation */}
        {showResendConfirmation && (
          <div style={{ marginTop: '4px' }}>
            <p
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: 'var(--warning)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 2px',
              }}
            >
              We already sent a confirmation email here.
            </p>
            <p
              style={{
                fontSize: '12px',
                fontWeight: 400,
                color: 'rgba(255,255,255,0.50)',
                fontFamily: 'var(--font-sans)',
                margin: '0 0 12px',
                lineHeight: 1.4,
              }}
            >
              Please check your inbox and spam folder.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span
                onClick={resendConfirmation}
                style={{
                  color: confirmResendState === 'sent' ? 'var(--gain)' : 'var(--accent)',
                  fontSize: '14px',
                  fontFamily: 'var(--font-sans)',
                  cursor: confirmResendState === 'idle' ? 'pointer' : 'default',
                  textAlign: 'center',
                }}
              >
                {confirmResendState === 'sent'
                  ? 'Email resent ✓'
                  : confirmResendState === 'loading'
                    ? 'Sending…'
                    : 'Resend confirmation email'}
              </span>

              <span
                onClick={() => {
                  setEmail('');
                  setShowResendConfirmation(false);
                  setEmailTouched(false);
                }}
                style={{
                  color: 'rgba(255,255,255,0.50)',
                  fontSize: '14px',
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                Use a different email
              </span>
            </div>
          </div>
        )}

        {/* Password */}
        <div style={{ width: '100%' }}>
          <Input
            label="PASSWORD"
            placeholder="Create a password"
            type="password"
            value={password}
            onChange={(v) => setPassword(v)}
            showToggle
            disabled={submitting}
          />

          {/* Password strength meter */}
          <div style={{ marginTop: '4px' }}>
            <PasswordStrength password={password} />
          </div>
        </div>

        {/* Confirm Password */}
        <div style={{ width: '100%' }}>
          <Input
            label="CONFIRM PASSWORD"
            placeholder="Confirm your password"
            type="password"
            value={confirmPassword}
            onChange={(v) => {
              setConfirmPassword(v);
              if (!confirmTouched) setConfirmTouched(true);
            }}
            showToggle
            disabled={submitting}
          />

          {/* Match indicator */}
          {showMatchIndicator && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '6px',
                color: passwordsMatch ? 'var(--gain)' : 'var(--loss)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
                transition: 'color 150ms var(--ease-out)',
              }}
            >
              {passwordsMatch ? (
                <>
                  <CheckCircle size={14} />
                  <span>Passwords match</span>
                </>
              ) : (
                <>
                  <XCircle size={14} />
                  <span>Passwords don&apos;t match</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ TERMS TEXT ═══ */}
      <p
        style={{
          marginTop: '8px',
          marginBottom: 0,
          fontSize: '11px',
          fontWeight: 400,
          color: 'rgba(255,255,255,0.30)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          lineHeight: 1.5,
        }}
      >
        By creating an account you agree to our{' '}
        <span
          onClick={() => router.push('/terms')}
          style={{
            textDecoration: 'underline',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.30)',
          }}
        >
          Terms of Service
        </span>{' '}
        and{' '}
        <span
          onClick={() => router.push('/privacy')}
          style={{
            textDecoration: 'underline',
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.30)',
          }}
        >
          Privacy Policy
        </span>
        .
      </p>

      {/* ═══ CREATE ACCOUNT BUTTON ═══ */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        style={{
          width: '100%',
          height: '56px',
          borderRadius: '999px',
          border: 'none',
          background: canSubmit && !submitting ? '#ffffff' : 'rgba(255,255,255,0.20)',
          color: canSubmit && !submitting ? '#000000' : 'rgba(0,0,0,0.40)',
          fontSize: '17px',
          fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          cursor: canSubmit && !submitting ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '16px',
          flexShrink: 0,
          transition: 'background 200ms var(--ease-out)',
        }}
      >
        {submitting ? (
          <>
            <Loader2 size={20} style={{ animation: 'spin 0.7s linear infinite' }} />
            Creating account…
          </>
        ) : (
          'Create account'
        )}
      </button>

      {/* ═══ SIGN IN LINK ═══ */}
      <button
        onClick={() => router.push('/login')}
        style={{
          marginTop: '16px',
          background: 'none',
          border: 'none',
          fontSize: '14px',
          fontWeight: 400,
          color: 'rgba(255,255,255,0.50)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          padding: 0,
          paddingBottom: 'max(32px, env(safe-area-inset-bottom, 0px))',
          width: '100%',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Already have an account? Sign in
      </button>

      {/* Spin keyframes for loader */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

// ── Check Email View ────────────────────────────────────────
// Rendered after successful signUp (email confirmation required).
// No back button. Resend cooldown: 30s.

interface CheckEmailViewProps {
  email: string;
  onSignIn: () => void;
}

function CheckEmailView({ email, onSignIn }: CheckEmailViewProps) {
  const router = useRouter();
  const [resendState, setResendState] = useState<'idle' | 'loading' | 'sent'>('idle');
  const [cooldown, setCooldown] = useState(0);

  // Countdown timer for resend cooldown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          setResendState('idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (resendState !== 'idle') return;
    setResendState('loading');

    try {
      const { getSupabaseBrowserClient } = await import('@/lib/auth/supabase-client');
      const supabase = getSupabaseBrowserClient();

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo: `${(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')}/auth/complete`,
        },
      });

      if (error) {
        console.error('[CheckEmail] Resend failed:', error.message);
      }
    } catch {}

    setResendState('sent');
    setCooldown(30);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100dvh',
        background: '#0a0f1e',
        color: '#fff',
        fontFamily: 'var(--font-sans)',
        alignItems: 'center',
        padding: '24px',
      }}
    >
      {/* ═══ TOP BAR — VantageOrb centered, no back ═══ */}
      <div
        style={{
          width: '100%',
          height: '120px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <VantageOrb size={100} animate showEntrance />
      </div>

      {/* ═══ HEADLINE ═══ */}
      <h1
        style={{
          marginTop: '16px',
          marginBottom: '24px',
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
          inbox.
        </span>
      </h1>

      {/* ═══ SUBTEXT ═══ */}
      <div
        style={{
          textAlign: 'center',
          marginBottom: '20px',
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
          We sent a confirmation link to
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
          Click it to activate your account.
        </p>
      </div>

      {/* ═══ EXPIRY NOTE ═══ */}
      <p
        style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.40)',
          textAlign: 'center',
          margin: '0 0 32px',
          fontFamily: 'var(--font-sans)',
        }}
      >
        The link expires in 24 hours.
      </p>

      {/* ═══ RESEND ═══ */}
      <button
        onClick={handleResend}
        disabled={resendState !== 'idle'}
        style={{
          background: 'none',
          border: 'none',
          fontSize: '14px',
          fontWeight: 400,
          color: resendState === 'sent' ? 'var(--gain)' : 'var(--accent)',
          cursor: resendState === 'idle' ? 'pointer' : 'default',
          padding: '8px 12px',
          fontFamily: 'var(--font-sans)',
          textAlign: 'center',
          transition: 'color 0.2s',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {resendState === 'sent'
          ? `Email resent ✓ (${cooldown}s)`
          : resendState === 'loading'
            ? 'Sending…'
            : "Didn't get it? Resend email"}
      </button>

      {/* ═══ SIGN IN LINK ═══ */}
      <button
        onClick={onSignIn}
        style={{
          marginTop: '16px',
          background: 'none',
          border: 'none',
          fontSize: '14px',
          fontWeight: 400,
          color: 'rgba(255,255,255,0.40)',
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          cursor: 'pointer',
          padding: '12px 0',
          width: '100%',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        Already have an account? Sign in
      </button>
    </div>
  );
}
