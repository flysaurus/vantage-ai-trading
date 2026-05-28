'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successEmail, setSuccessEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    console.log('👉 [FORGOT-PASSWORD] Requesting reset for:', email);

    try {
      if (!email) {
        throw new Error('Email required');
      }

      if (!email.includes('@')) {
        throw new Error('Please enter a valid email');
      }

      const response = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      // request-password-reset always returns 200 (prevents email enumeration)
      // — but we still check ok in case of network errors
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      console.log('✅ Password reset email sent');
      setSuccess(true);
      setSuccessEmail(email);
      setEmail('');
    } catch (err: any) {
      console.error('❌ Forgot password error:', err.message);
      setError(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-blue-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">Check Your Email</h1>
              <p className="text-slate-400 mb-6">
                We&apos;ve sent a password reset link to{' '}
                <span className="text-cyan-400 font-medium">{successEmail}</span>
              </p>

              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-6 space-y-2">
                <p className="text-slate-300 text-sm">
                  👉 Click the link in your email to reset your password
                </p>
                <p className="text-slate-400 text-xs">
                  The link expires in 1 hour for security
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-slate-400 text-sm">
                  Didn&apos;t receive the email? Check your spam folder.
                </p>

                <button
                  onClick={() => {
                    setSuccess(false);
                    setEmail('');
                  }}
                  className="text-cyan-400 hover:text-cyan-300 text-sm font-medium"
                >
                  Try another email →
                </button>
              </div>

              <div className="mt-6 pt-6 border-t border-slate-700">
                <Link
                  href="/login"
                  className="text-slate-400 hover:text-slate-300 text-sm"
                >
                  ← Back to login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">Reset Password</h1>
          <p className="text-slate-400 text-center mb-8">
            Enter your email and we&apos;ll send you a reset link
          </p>

          {error && (
            <div className="p-4 bg-red-900/30 text-red-300 rounded-lg mb-6 border border-red-700 text-sm">
              ❌ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                autoFocus
                required
              />
              <p className="text-xs text-slate-400 mt-1">
                We&apos;ll send a reset link to this email
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition mt-6"
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-700">
            <Link
              href="/login"
              className="block text-center text-slate-400 hover:text-slate-300 text-sm font-medium"
            >
              ← Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
