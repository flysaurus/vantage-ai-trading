// ─── Login Page ───────────────────────────────────────────────
// Professional auth flow with clear feedback at every step.
// Handles: sign in, sign up, email confirmation, resend, errors.

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { resendConfirmation } from '@/lib/auth';
import { Eye, EyeOff, LogIn, UserPlus, Mail, ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, isAuthenticated, isLoading } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Confirmation sent state
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  // ─── Submit Handler ─────────────────────────────────────────

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!email.trim() || !password) {
        setError('Please enter your email and password.');
        return;
      }

      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }

      setSubmitting(true);

      try {
        if (mode === 'signup') {
          const result = await signUp(email.trim(), password, displayName.trim() || undefined);
          if (result?.needsConfirmation) {
            setConfirmedEmail(email.trim());
            setConfirmationSent(true);
            return;
          }
          // Auto-confirmed — straight to app
          router.push('/');
        } else {
          await signIn(email.trim(), password);
          router.push('/');
        }
      } catch (err: any) {
        const message = err?.message || 'Something went wrong. Please try again.';

        if (message.toLowerCase().includes('invalid login') || message.includes('Invalid')) {
          setError('Invalid email or password.');
        } else if (message.toLowerCase().includes('not confirmed') || message.includes('not verified')) {
          setError('Email not verified yet. Please check your inbox for the confirmation link.');
        } else if (message.toLowerCase().includes('rate limit') || message.includes('too many')) {
          setError('Too many attempts. Please wait a moment and try again.');
        } else if (message.toLowerCase().includes('already registered') || message.includes('already exists')) {
          setError('An account with this email already exists. Try signing in instead.');
        } else if (message.toLowerCase().includes('network') || message.includes('fetch')) {
          setError('Network error. Please check your connection and try again.');
        } else {
          setError(message);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [email, password, displayName, mode, signIn, signUp, router]
  );

  // ─── Resend Confirmation ─────────────────────────────────────

  const handleResendConfirmation = useCallback(async () => {
    setResending(true);
    setResendMessage(null);
    try {
      const result = await resendConfirmation(confirmedEmail);
      setResendMessage(result.message);
    } catch {
      setResendMessage('Unable to resend. Please try again later.');
    } finally {
      setResending(false);
    }
  }, [confirmedEmail]);

  // ─── Redirect if authenticated ──────────────────────────────

  if (isAuthenticated && !isLoading) {
    router.push('/');
    return null;
  }

  // ─── Loading Screen ─────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <span className="logo-gradient">Vantage</span>
          </div>
          <div className="loading-spinner-center" />
        </div>
        <style jsx>{`
          .loading-spinner-center {
            width: 24px;
            height: 24px;
            margin: 24px auto 0;
            border: 2px solid rgba(6, 182, 212, 0.2);
            border-top-color: var(--accent-cyan, #06b6d4);
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ─── Confirmation Sent Screen ───────────────────────────────

  if (confirmationSent) {
    return (
      <div className="login-page">
        <div className="login-card confirmation-card">
          <button
            className="back-button"
            onClick={() => { setConfirmationSent(false); setError(null); }}
          >
            <ArrowLeft size={16} />
            Back to sign in
          </button>

          <div className="confirmation-icon">
            <Mail size={40} />
          </div>

          <h2 className="confirmation-title">Verify your email</h2>

          <p className="confirmation-text">
            We&apos;ve sent a verification link to
          </p>
          <p className="confirmation-email">{confirmedEmail}</p>

          <div className="confirmation-steps">
            <div className="step">
              <span className="step-num">1</span>
              <span>Open your inbox and find the email from Vantage</span>
            </div>
            <div className="step">
              <span className="step-num">2</span>
              <span>Click the confirmation link in the email</span>
            </div>
            <div className="step">
              <span className="step-num">3</span>
              <span>Return here and sign in with your credentials</span>
            </div>
          </div>

          {resendMessage && (
            <div className={`resend-status ${resendMessage.includes('resent') ? 'success' : 'warning'}`}>
              {resendMessage}
            </div>
          )}

          <button
            className="resend-button"
            onClick={handleResendConfirmation}
            disabled={resending}
          >
            {resending ? (
              <span className="spinner" />
            ) : (
              <RefreshCw size={14} />
            )}
            Resend verification email
          </button>

          <p className="confirmation-note">
            Didn&apos;t get it? Check your spam folder, or try a different email address.
          </p>
        </div>

        <style jsx>{`
          .confirmation-card {
            text-align: center;
          }
          .back-button {
            display: flex;
            align-items: center;
            gap: 6px;
            background: none;
            border: none;
            color: var(--text-muted, #94a3b8);
            font-size: 13px;
            font-family: inherit;
            cursor: pointer;
            margin-bottom: 24px;
            padding: 4px 0;
          }
          .back-button:hover {
            color: var(--text-primary, #f1f5f9);
          }
          .confirmation-icon {
            width: 72px;
            height: 72px;
            margin: 0 auto 16px;
            background: rgba(6, 182, 212, 0.1);
            border: 2px solid rgba(6, 182, 212, 0.2);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--accent-cyan, #06b6d4);
          }
          .confirmation-title {
            font-size: 22px;
            font-weight: 700;
            color: var(--text-primary, #f1f5f9);
            margin: 0 0 8px;
          }
          .confirmation-text {
            color: var(--text-muted, #94a3b8);
            font-size: 14px;
            margin: 0 0 4px;
          }
          .confirmation-email {
            color: var(--accent-cyan, #06b6d4);
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 24px;
            word-break: break-all;
          }
          .confirmation-steps {
            text-align: left;
            background: var(--bg-input, #0f172a);
            border: 1px solid var(--border-primary, #334155);
            border-radius: 10px;
            padding: 16px;
            margin-bottom: 20px;
          }
          .step {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 8px 0;
            color: var(--text-secondary, #cbd5e1);
            font-size: 13px;
            line-height: 1.5;
          }
          .step + .step {
            border-top: 1px solid var(--border-subtle, #1e293b);
          }
          .step-num {
            width: 22px;
            height: 22px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(6, 182, 212, 0.15);
            border-radius: 50%;
            color: var(--accent-cyan, #06b6d4);
            font-size: 12px;
            font-weight: 700;
          }
          .resend-status {
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            margin-bottom: 12px;
          }
          .resend-status.success {
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.2);
            color: #22c55e;
          }
          .resend-status.warning {
            background: rgba(250, 204, 21, 0.1);
            border: 1px solid rgba(250, 204, 21, 0.2);
            color: #facc15;
          }
          .resend-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
            padding: 10px;
            background: transparent;
            border: 1px solid var(--border-primary, #334155);
            border-radius: 8px;
            color: var(--text-secondary, #cbd5e1);
            font-size: 14px;
            font-family: inherit;
            cursor: pointer;
            transition: border-color 0.2s;
            margin-bottom: 12px;
          }
          .resend-button:hover:not(:disabled) {
            border-color: var(--accent-cyan, #06b6d4);
            color: var(--accent-cyan, #06b6d4);
          }
          .resend-button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .confirmation-note {
            color: var(--text-dim, #64748b);
            font-size: 12px;
            line-height: 1.5;
          }
          .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(6, 182, 212, 0.3);
            border-top-color: var(--accent-cyan, #06b6d4);
            border-radius: 50%;
            animation: spin 0.6s linear infinite;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  // ─── Login / Sign Up Form ───────────────────────────────────

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <span className="logo-gradient">Vantage</span>
        </div>
        <p className="login-subtitle">AI-first trading, in your pocket</p>

        {/* Mode Toggle */}
        <div className="mode-toggle">
          <button
            className={`mode-btn ${mode === 'signin' ? 'active' : ''}`}
            onClick={() => { setMode('signin'); setError(null); }}
            disabled={submitting}
          >
            Sign In
          </button>
          <button
            className={`mode-btn ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => { setMode('signup'); setError(null); }}
            disabled={submitting}
          >
            Sign Up
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="login-form">
          {mode === 'signup' && (
            <div className="form-group">
              <label htmlFor="displayName" className="form-label">
                Display Name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="form-input"
                autoComplete="name"
                disabled={submitting}
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email" className="form-label">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="form-input"
              autoComplete="email"
              autoFocus
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">
              Password
            </label>
            <div className="password-wrapper">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="form-input"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                disabled={submitting}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="form-error">
              <ShieldCheck size={14} className="error-icon" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="form-submit"
            disabled={submitting}
          >
            {submitting ? (
              <span className="spinner" />
            ) : mode === 'signup' ? (
              <>
                <UserPlus size={16} />
                Create Account
              </>
            ) : (
              <>
                <LogIn size={16} />
                Sign In
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="login-divider">
          <span>or</span>
        </div>

        {/* Google Sign-In (disabled — ready for later) */}
        <button className="form-google" disabled title="Coming soon">
          <svg viewBox="0 0 24 24" width="18" height="18" className="google-icon">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Continue with Google
        </button>

        {/* Footer */}
        <p className="login-footer">
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                className="link-button"
                onClick={() => { setMode('signup'); setError(null); }}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                className="link-button"
                onClick={() => { setMode('signin'); setError(null); }}
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>

      {/* Styles */}
      <style jsx>{`
        .login-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100dvh;
          padding: 16px;
          background: var(--bg-deep, #0a0e27);
        }

        .login-card {
          width: 100%;
          max-width: 380px;
          background: var(--bg-primary, #0f172a);
          border: 1px solid var(--border-primary, #334155);
          border-radius: 16px;
          padding: 32px 24px;
          animation: fadeIn 0.4s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .login-logo {
          text-align: center;
          margin-bottom: 4px;
        }

        .logo-gradient {
          font-size: 32px;
          font-weight: 800;
          background: linear-gradient(135deg, var(--accent-cyan, #06b6d4), var(--accent-teal, #0d9488));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          letter-spacing: -0.5px;
        }

        .login-subtitle {
          text-align: center;
          color: var(--text-muted, #94a3b8);
          font-size: 13px;
          margin-bottom: 28px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary, #cbd5e1);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-input {
          width: 100%;
          padding: 10px 12px;
          background: var(--bg-input, #0f172a);
          border: 1px solid var(--border-primary, #334155);
          border-radius: 8px;
          color: var(--text-primary, #f1f5f9);
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.2s, box-shadow 0.2s;
          outline: none;
        }

        .form-input::placeholder { color: var(--text-dim, #64748b); }

        .form-input:focus {
          border-color: var(--accent-cyan, #06b6d4);
          box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.15);
        }

        .form-input:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .password-wrapper {
          position: relative;
        }
        .password-wrapper .form-input {
          padding-right: 40px;
        }
        .password-toggle {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          color: var(--text-muted, #94a3b8);
          cursor: pointer;
          padding: 4px;
          display: flex;
          align-items: center;
        }
        .password-toggle:hover {
          color: var(--text-primary, #f1f5f9);
        }

        .form-error {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          background: rgba(248, 113, 113, 0.08);
          border: 1px solid rgba(248, 113, 113, 0.2);
          border-radius: 8px;
          padding: 10px 12px;
          color: var(--accent-red, #f87171);
          font-size: 13px;
          line-height: 1.5;
        }
        .error-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .form-submit {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, var(--accent-cyan, #06b6d4), var(--accent-teal, #0d9488));
          border: none;
          border-radius: 8px;
          color: white;
          font-size: 15px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: opacity 0.2s, transform 0.1s;
          margin-top: 4px;
        }
        .form-submit:hover:not(:disabled) {
          opacity: 0.92;
          transform: translateY(-1px);
        }
        .form-submit:active:not(:disabled) {
          transform: translateY(0);
        }
        .form-submit:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .spinner {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .login-divider {
          display: flex;
          align-items: center;
          margin: 24px 0 16px;
          color: var(--text-dim, #64748b);
          font-size: 12px;
        }
        .login-divider::before,
        .login-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border-subtle, #1e293b);
        }
        .login-divider span { padding: 0 12px; }

        .form-google {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          padding: 10px;
          background: var(--bg-secondary, #1e293b);
          border: 1px solid var(--border-primary, #334155);
          border-radius: 8px;
          color: var(--text-secondary, #cbd5e1);
          font-size: 14px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .form-google:hover:not(:disabled) {
          border-color: var(--accent-cyan, #06b6d4);
        }
        .form-google:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .google-icon { flex-shrink: 0; }

        .login-footer {
          text-align: center;
          margin-top: 20px;
          font-size: 13px;
          color: var(--text-muted, #94a3b8);
        }
        .link-button {
          background: none;
          border: none;
          color: var(--accent-cyan, #06b6d4);
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
        }
        .link-button:hover { text-decoration: underline; }

        .mode-toggle {
          display: flex;
          background: var(--bg-input, #0f172a);
          border: 1px solid var(--border-primary, #334155);
          border-radius: 10px;
          padding: 3px;
          margin-bottom: 20px;
        }
        .mode-btn {
          flex: 1;
          padding: 8px;
          background: transparent;
          border: none;
          border-radius: 8px;
          color: var(--text-muted, #94a3b8);
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.2s;
        }
        .mode-btn.active {
          background: var(--bg-secondary, #1e293b);
          color: var(--text-primary, #f1f5f9);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        .mode-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
