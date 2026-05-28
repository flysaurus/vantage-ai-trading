// ─── Login / Sign Up Page ─────────────────────────────────────
// Custom auth API — no Supabase Auth dependency.
// Combined Sign In + Sign Up + 2FA in one polished page.

'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, LogIn, UserPlus, Mail, ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';

const BUILD = process.env.NEXT_PUBLIC_BUILD || 'dev';

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Signup confirmation sent
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // 2FA
  const [requires2FA, setRequires2FA] = useState(false);
  const [userId2FA, setUserId2FA] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [loading2FA, setLoading2FA] = useState(false);

  // ─── Display Name Validation ──────────────────────────────

  const NAME_MIN = 2;
  const NAME_MAX = 50;
  const NAME_REGEX = /^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF][a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s\-'.]*$/;

  function validateDisplayName(name: string): string | null {
    const trimmed = name.trim();
    if (mode !== 'signup') return null;
    if (!trimmed) return 'Full name is required.';
    if (trimmed.length < NAME_MIN) return `Name must be at least ${NAME_MIN} characters.`;
    if (trimmed.length > NAME_MAX) return `Name must be under ${NAME_MAX} characters.`;
    if (!/^[a-zA-Z]/.test(trimmed)) return 'Name must start with a letter.';
    if (!NAME_REGEX.test(trimmed)) return 'Name can only contain letters, spaces, hyphens, and apostrophes.';
    if (trimmed.split(/\s+/).filter(Boolean).length < 1) return 'Please enter your full name.';
    return null;
  }

  const displayNameError = mode === 'signup' ? validateDisplayName(displayName) : null;

  // ─── Submit ────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate name for signup
    if (mode === 'signup') {
      const nameErr = validateDisplayName(displayName);
      if (nameErr) {
        setError(nameErr);
        return;
      }
    }

    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signup') {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            password,
            displayName: displayName.trim(),
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Signup failed');
        }

        // If email was sent (SendGrid), show confirmation screen
        // Verification token always included for manual fallback
        if (data.emailSent || data.userId) {
          setConfirmedEmail(email.trim());
          if (data.verificationToken) {
            setVerificationToken(data.verificationToken);
          }
          setConfirmationSent(true);
          setSubmitting(false);
          return;
        }
      } else {
        // Sign In
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Login failed');
        }

        // 2FA required?
        if (data.requires2FA) {
          setRequires2FA(true);
          setUserId2FA(data.userId);
          setPassword('');
          setSubmitting(false);
          return;
        }

        // Direct login — redirect
        router.replace('/');
      }
    } catch (err: any) {
      const msg = String(err?.message || err || 'Something went wrong.');
      const low = msg.toLowerCase();
      if (low.includes('invalid email') || low.includes('invalid credential') || low.includes('not found'))
        setError('Invalid email or password. Please check and try again.');
      else if (low.includes('not verified') || low.includes('verify your email'))
        setError('Email not verified yet. Check your inbox for the confirmation link.');
      else if (low.includes('not active'))
        setError('This account has been deactivated. Contact support.');
      else if (low.includes('already exists') || low.includes('already registered'))
        setError('An account with this email already exists. Please sign in.');
      else
        setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading2FA(true);
    setError(null);

    try {
      if (!twoFACode || twoFACode.length !== 6) {
        throw new Error('Enter a valid 6-digit code');
      }

      const verifyRes = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA, code: twoFACode }),
      });
      const verifyData = await verifyRes.json();

      if (!verifyRes.ok) {
        throw new Error(verifyData.error || '2FA verification failed');
      }

      // Create session
      const sessionRes = await fetch('/api/auth/login-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA }),
      });

      if (!sessionRes.ok) {
        const sessionData = await sessionRes.json();
        throw new Error(sessionData.error || 'Failed to create session');
      }

      router.replace('/');
    } catch (err: any) {
      setError(err.message || '2FA verification failed');
    } finally {
      setLoading2FA(false);
    }
  };

  const handleResendConfirmation = async () => {
    setResending(true);
    setResendMessage(null);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmedEmail, resend: true }),
      });
      const data = await res.json();
      setResendMessage(data.emailSent
        ? 'Verification email resent! Check your inbox.'
        : 'Email sent. If you don\'t see it, check spam.');
    } catch {
      setResendMessage('Unable to resend. Please try again later.');
    } finally {
      setResending(false);
    }
  };

  // ─── 2FA Screen ──────────────────────────────────────────────

  if (requires2FA) {
    return (
      <div className="page" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27' }}>
        <div className="card" style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', animation: 'fadeIn .4s ease-out' }}>
          <div className="icon-circle" style={{ width: 56, height: 56, margin: '0 auto 20px', background: 'rgba(6,182,212,.1)', border: '2px solid rgba(6,182,212,.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06b6d4' }}>
            <ShieldCheck size={28} />
          </div>
          <h2 className="title" style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', textAlign: 'center', margin: '0 0 16px' }}>Two-Factor Authentication</h2>
          <p className="sub" style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', margin: '0 0 24px' }}>Enter the 6-digit code from your authenticator app</p>

          {error && (
            <div className="err" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 8, padding: '10px 12px', color: '#f87171', fontSize: 13, marginBottom: 16 }}>
              <ShieldCheck size={14} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handle2FASubmit}>
            <input
              type="text"
              value={twoFACode}
              onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              maxLength={6}
              autoFocus
              className="inp-2fa"
              style={{ width: '100%', padding: '14px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 28, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 8, outline: 'none' }}
              disabled={loading2FA}
            />

            <button
              type="submit"
              disabled={loading2FA || twoFACode.length !== 6}
              className="submit-btn"
              style={{ width: '100%', padding: 12, marginTop: 16, background: 'linear-gradient(135deg,#06b6d4,#0d9488)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: loading2FA ? 0.6 : 1 }}
            >
              {loading2FA ? 'Verifying...' : 'Verify Code'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 20 }}>
            <button
              onClick={() => { setRequires2FA(false); setTwoFACode(''); setError(null); }}
              className="link"
              style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              ← Back to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Confirmation Screen ────────────────────────────────────

  if (confirmationSent) {
    return (
      <div className="page" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27' }}>
        <div className="card" style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
          <button className="back-btn" onClick={() => { setConfirmationSent(false); setError(null); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer', marginBottom: 24 }}>
            <ArrowLeft size={16} /> Back to sign in
          </button>
          <div className="mail-icon" style={{ width: 72, height: 72, margin: '0 auto 16px', background: 'rgba(6,182,212,.1)', border: '2px solid rgba(6,182,212,.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#06b6d4' }}>
            <Mail size={40} />
          </div>
          <h2 className="title" style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>Verify your email</h2>
          <p className="sub" style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 4px' }}>We&apos;ve sent a verification link to</p>
          <p className="email" style={{ color: '#06b6d4', fontSize: 16, fontWeight: 600, margin: '0 0 24px', wordBreak: 'break-all' }}>{confirmedEmail}</p>
          <div className="steps" style={{ textAlign: 'left', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 16, marginBottom: 20 }}>
            <div className="step" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', color: '#cbd5e1', fontSize: 13, lineHeight: 1.5 }}>
              <span className="n" style={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,182,212,.15)', borderRadius: '50%', color: '#06b6d4', fontSize: 12, fontWeight: 700 }}>1</span> Open your inbox and find the email from Vantage
            </div>
            <div className="step" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, borderTop: '1px solid #1e293b' }}>
              <span className="n" style={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,182,212,.15)', borderRadius: '50%', color: '#06b6d4', fontSize: 12, fontWeight: 700 }}>2</span> Click the confirmation link
            </div>
            <div className="step" style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', color: '#cbd5e1', fontSize: 13, lineHeight: 1.5, borderTop: '1px solid #1e293b' }}>
              <span className="n" style={{ width: 22, height: 22, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(6,182,212,.15)', borderRadius: '50%', color: '#06b6d4', fontSize: 12, fontWeight: 700 }}>3</span> Return here and sign in
            </div>
          </div>
          {verificationToken && (
            <div style={{
              textAlign: 'left', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)',
              borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 12, color: '#facc15',
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ Email not arriving?</div>
              <a
                href={`/verify-email?token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(confirmedEmail)}`}
                target="_blank"
                style={{ color: '#06b6d4', textDecoration: 'underline', fontSize: 11, wordBreak: 'break-all' }}
              >
                Click here to verify manually
              </a>
            </div>
          )}
          {resendMessage && (
            <div style={{ padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12, background: resendMessage.includes('resent') ? 'rgba(34,197,94,.1)' : 'rgba(250,204,21,.1)', border: resendMessage.includes('resent') ? '1px solid rgba(34,197,94,.2)' : '1px solid rgba(250,204,21,.2)', color: resendMessage.includes('resent') ? '#22c55e' : '#facc15' }}>
              {resendMessage}
            </div>
          )}
          <button className="resend-btn" onClick={handleResendConfirmation} disabled={resending}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 10, background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
            {resending ? <span style={{ width: 14, height: 14, border: '2px solid rgba(6,182,212,.3)', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} /> : <RefreshCw size={14} />}
            Resend verification email
          </button>
          <p className="note" style={{ color: '#64748b', fontSize: 12, lineHeight: 1.5 }}>Didn&apos;t get it? Check spam or try a different email.</p>
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ─── Login / Sign Up Form ───────────────────────────────────

  return (
    <div className="page" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27' }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', animation: 'fadeIn .4s ease-out' }}>
        <div className="logo" style={{ textAlign: 'center', marginBottom: 4 }}>
          <span className="logo-text" style={{ fontSize: 32, fontWeight: 800, background: 'linear-gradient(135deg,#06b6d4,#0d9488)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-.5px' }}>Vantage</span>
        </div>
        <p className="tagline" style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, marginBottom: 28 }}>AI-first trading, in your pocket</p>

        <div className="tabs" style={{ display: 'flex', background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 3, marginBottom: 20 }}>
          <button
            className="tab-btn"
            onClick={() => { setMode('signin'); setError(null); }}
            disabled={submitting}
            style={{ flex: 1, padding: 8, background: mode === 'signin' ? '#1e293b' : 'transparent', border: 'none', borderRadius: 8, color: mode === 'signin' ? '#f1f5f9' : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .2s', boxShadow: mode === 'signin' ? '0 1px 3px rgba(0,0,0,.3)' : 'none' }}
          >
            Sign In
          </button>
          <button
            className="tab-btn"
            onClick={() => { setMode('signup'); setError(null); }}
            disabled={submitting}
            style={{ flex: 1, padding: 8, background: mode === 'signup' ? '#1e293b' : 'transparent', border: 'none', borderRadius: 8, color: mode === 'signup' ? '#f1f5f9' : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .2s', boxShadow: mode === 'signup' ? '0 1px 3px rgba(0,0,0,.3)' : 'none' }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'signup' && (
            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label className="lbl" style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.5px' }}>Full Name <span style={{ color: '#f87171' }}>*</span></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Smith"
                autoComplete="name"
                required
                disabled={submitting}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: '#0f172a',
                  border: `1px solid ${displayName && displayNameError ? '#f87171' : '#334155'}`,
                  borderRadius: 8,
                  color: '#f1f5f9',
                  fontSize: 14,
                  outline: 'none',
                }}
              />
              {displayName && displayNameError ? (
                <p style={{ fontSize: 11, color: '#f87171', margin: '2px 0 0' }}>{displayNameError}</p>
              ) : displayName.length >= 2 && !displayNameError ? (
                <p style={{ fontSize: 11, color: '#22c55e', margin: '2px 0 0' }}>✓ Looking good</p>
              ) : (
                <p style={{ fontSize: 11, color: '#64748b', margin: '2px 0 0' }}>Enter your first and last name</p>
              )}
            </div>
          )}
          <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="lbl" style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.5px' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              disabled={submitting}
              style={{ width: '100%', padding: '10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }}
            />
          </div>
          <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="lbl" style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', textTransform: 'uppercase', letterSpacing: '.5px' }}>Password</label>
              {mode === 'signin' && (
                <a href="/forgot-password" style={{ fontSize: 12, color: '#06b6d4', textDecoration: 'none', fontWeight: 600 }}>Forgot?</a>
              )}
            </div>
            <div className="pw" style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                disabled={submitting}
                style={{ width: '100%', padding: '10px 40px 10px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' }}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, display: 'flex' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="err" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'rgba(248,113,113,.08)', border: '1px solid rgba(248,113,113,.2)', borderRadius: 8, padding: '10px 12px', color: '#f87171', fontSize: 13, lineHeight: 1.5 }}>
              <ShieldCheck size={14} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 12, background: 'linear-gradient(135deg,#06b6d4,#0d9488)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 15, fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', marginTop: 4, opacity: submitting ? 0.6 : 1 }}
          >
            {submitting ? (
              <span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite', display: 'inline-block' }} />
            ) : mode === 'signup' ? (
              <><UserPlus size={16} /> Create Account</>
            ) : (
              <><LogIn size={16} /> Sign In</>
            )}
          </button>
        </form>

        <div className="divider" style={{ display: 'flex', alignItems: 'center', margin: '24px 0 16px', color: '#64748b', fontSize: 12 }}>
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
          <span style={{ padding: '0 12px' }}>or</span>
          <span style={{ flex: 1, height: 1, background: '#1e293b' }} />
        </div>

        <button className="google-btn" disabled title="Coming soon"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 10, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', fontSize: 14, fontWeight: 500, cursor: 'not-allowed', opacity: 0.4 }}>
          <svg width={16} height={16} viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <div className="ftr" style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#94a3b8' }}>
          {mode === 'signin' ? (
            <>Don&apos;t have an account? <button type="button" onClick={() => { setMode('signup'); setError(null); }} style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sign up</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => { setMode('signin'); setError(null); }} style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Sign in</button></>
          )}
        </div>
        <div style={{ textAlign: 'center', marginTop: 12, fontSize: 10, color: '#475569' }}>build: {BUILD}</div>
      </div>

      <style>{`
        @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        input:focus { border-color:#06b6d4 !important;box-shadow:0 0 0 2px rgba(6,182,212,.15) }
        input::placeholder { color:#64748b }
        input:disabled { opacity:.6;cursor:not-allowed }
        .tab-btn:hover:not(:disabled) { color:#f1f5f9 }
        .pw-toggle:hover { color:#f1f5f9 }
        .submit-btn:hover:not(:disabled) { opacity:.92;transform:translateY(-1px) }
        .submit-btn:active:not(:disabled) { transform:translateY(0) }
        .google-btn:hover:not(:disabled) { border-color:#06b6d4 }
        .ftr button:hover { text-decoration:underline }
      `}</style>
    </div>
  );
}
