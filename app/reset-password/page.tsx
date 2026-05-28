'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    const emailParam = searchParams.get('email');
    const tokenParam = searchParams.get('token');

    console.log('👉 [RESET-PASSWORD] Page loaded');

    if (!emailParam || !tokenParam) {
      console.error('❌ Invalid reset link');
      setInvalidLink(true);
      return;
    }

    setEmail(decodeURIComponent(emailParam));
    setToken(tokenParam);
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    console.log('👉 [RESET-PASSWORD] Resetting password for:', email);

    try {
      if (!newPassword || !confirmPassword) {
        throw new Error('Both password fields required');
      }

      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      if (!token) {
        throw new Error('Invalid reset token');
      }

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          token,
          newPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Password reset failed');
      }

      console.log('✅ Password reset successful');
      setSuccess(true);

      setTimeout(() => {
        router.push('/login');
      }, 3000);
    } catch (err: any) {
      console.error('❌ Reset password error:', err.message);
      setError(err.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  // Invalid Link
  if (invalidLink) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-red-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">Invalid Reset Link</h1>
              <p className="text-slate-400 mb-6">
                This password reset link is invalid or has expired.
              </p>

              <Link
                href="/forgot-password"
                className="inline-block bg-cyan-500 hover:bg-cyan-600 text-white font-semibold px-6 py-2.5 rounded-lg transition"
              >
                Request New Reset Link
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success
  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-8 h-8 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>

              <h1 className="text-2xl font-bold text-white mb-2">Password Reset!</h1>
              <p className="text-slate-400 mb-6">
                Your password has been reset successfully. You can now log in with your new password.
              </p>

              <p className="text-slate-400 text-sm mb-6">
                Redirecting to login in 3 seconds...
              </p>

              <Link
                href="/login"
                className="inline-block bg-cyan-500 hover:bg-cyan-600 text-white font-semibold px-6 py-2.5 rounded-lg transition"
              >
                Go to Login Now →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Reset Form
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">Create New Password</h1>
          <p className="text-slate-400 text-center mb-8">
            Enter a new password for your account
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
                disabled
                className="w-full bg-slate-800 text-slate-400 px-4 py-2.5 rounded-lg border border-slate-700 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                required
              />
              {newPassword && confirmPassword && newPassword === confirmPassword && (
                <p className="text-xs text-green-400 mt-1">✓ Passwords match</p>
              )}
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-400 mt-1">✗ Passwords do not match</p>
              )}
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-300 mb-2">Password strength:</p>
              <ul className="text-xs text-slate-400 space-y-1">
                <li className={newPassword.length >= 8 ? 'text-green-400' : ''}>
                  ✓ At least 8 characters
                </li>
                <li className={/[A-Z]/.test(newPassword) ? 'text-green-400' : ''}>
                  ✓ One uppercase letter
                </li>
                <li className={/[0-9]/.test(newPassword) ? 'text-green-400' : ''}>
                  ✓ One number
                </li>
                <li className={/[!@#$%^&*]/.test(newPassword) ? 'text-green-400' : ''}>
                  ✓ One special character (!@#$%^&*)
                </li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword || newPassword !== confirmPassword}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition mt-6"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
              <div className="text-center">
                <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <div className="w-8 h-8 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin"></div>
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Loading</h1>
                <p className="text-slate-400">Preparing password reset...</p>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
