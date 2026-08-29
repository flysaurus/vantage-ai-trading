'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';

export default function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successEmail, setSuccessEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing reset token. Use the link from your email.');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to reset password');
      } else {
        setSuccess(true);
        setSuccessEmail(data.email || null);
      }
    } catch {
      setError('Unable to reach the server. Please try again.');
    }

    setSubmitting(false);
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: '#0a0f1e',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 24px 40px',
        color: '#c9d1d9',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          background: 'transparent',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <button
          onClick={() => router.push('/login')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            color: '#8b949e',
          }}
        >
          <ChevronLeft size={20} />
          <span style={{ fontSize: '15px' }}>Back to Login</span>
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: '400px', margin: '0 auto', width: '100%' }}>
        {success ? (
          <div
            style={{
              textAlign: 'center',
              background: '#161b22',
              border: '1px solid #238636',
              borderRadius: '16px',
              padding: '32px 24px',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
            <h2 style={{ color: '#f8fafc', fontSize: '1.25rem', marginBottom: '12px' }}>
              Password Reset
            </h2>
            <p style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: '24px' }}>
              Your password has been reset{successEmail ? ` for ${successEmail}` : ''}. You can now sign in with your new password.
            </p>
            <button
              onClick={() => router.push('/login')}
              style={{
                background: '#06b6d4',
                color: '#0a0f1e',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Sign In
            </button>
          </div>
        ) : (
          <div
            style={{
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: '16px',
              padding: '32px 24px',
            }}
          >
            <h1 style={{ color: '#f8fafc', fontSize: '1.25rem', marginBottom: '8px', textAlign: 'center' }}>
              Set New Password
            </h1>
            <p style={{ color: '#8b949e', fontSize: '0.8125rem', textAlign: 'center', marginBottom: '24px' }}>
              {token
                ? 'Choose a new password for your account.'
                : 'Invalid or missing reset token.'}
            </p>

            {error && (
              <div
                style={{
                  background: 'rgba(218,54,51,0.1)',
                  border: '1px solid #da3633',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '16px',
                  fontSize: '0.8125rem',
                  color: '#f85149',
                }}
              >
                {error}
              </div>
            )}

            {token && (
              <form onSubmit={handleSubmit}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8125rem',
                    color: '#8b949e',
                    marginBottom: '6px',
                  }}
                >
                  New Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  autoComplete="new-password"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '15px',
                    marginBottom: '16px',
                    boxSizing: 'border-box',
                  }}
                />

                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8125rem',
                    color: '#8b949e',
                    marginBottom: '6px',
                  }}
                >
                  Confirm Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  autoComplete="new-password"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#0d1117',
                    border: '1px solid #30363d',
                    borderRadius: '8px',
                    color: '#f8fafc',
                    fontSize: '15px',
                    marginBottom: '24px',
                    boxSizing: 'border-box',
                  }}
                />

                <button
                  type="submit"
                  disabled={submitting || !password || !confirmPassword}
                  style={{
                    background: '#06b6d4',
                    color: '#0a0f1e',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px 32px',
                    fontSize: '15px',
                    fontWeight: 600,
                    cursor: submitting ? 'wait' : 'pointer',
                    width: '100%',
                    opacity: submitting || !password || !confirmPassword ? 0.5 : 1,
                  }}
                >
                  {submitting ? 'Resetting...' : 'Set New Password'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
