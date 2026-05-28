'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [userId2FA, setUserId2FA] = useState('');
  const [twoFACode, setTwoFACode] = useState('');
  const [loading2FA, setLoading2FA] = useState(false);
  const [error2FA, setError2FA] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    console.log('👉 [LOGIN] Attempting login:', email);

    try {
      if (!email || !password) {
        throw new Error('Email and password required');
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Check if 2FA is required
      if (data.requires2FA) {
        console.log('👉 [LOGIN] 2FA required');
        setRequires2FA(true);
        setUserId2FA(data.userId);
        setPassword('');
        return;
      }

      // No 2FA — login successful
      console.log('✅ Login successful');
      router.push('/');
    } catch (err: any) {
      console.error('❌ Login error:', err.message);
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading2FA(true);
    setError2FA('');

    console.log('👉 [2FA] Verifying code');

    try {
      if (!twoFACode) {
        throw new Error('2FA code required');
      }

      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA, code: twoFACode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '2FA verification failed');
      }

      console.log('✅ 2FA verified');

      // Create session after 2FA verification
      const sessionResponse = await fetch('/api/auth/login-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA }),
      });

      if (!sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        throw new Error(sessionData.error || 'Failed to create session');
      }

      router.push('/');
    } catch (err: any) {
      console.error('❌ 2FA error:', err.message);
      setError2FA(err.message || '2FA verification failed');
    } finally {
      setLoading2FA(false);
    }
  };

  const handleBackupCodeFlow = () => {
    const code = prompt('Enter your backup code:');
    if (code && code.trim()) {
      handle2FAVerify(code.trim());
    }
  };

  const handle2FAVerify = async (code: string) => {
    setLoading2FA(true);
    setError2FA('');

    try {
      const response = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '2FA verification failed');
      }

      const sessionResponse = await fetch('/api/auth/login-2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId2FA }),
      });

      if (!sessionResponse.ok) {
        const sessionData = await sessionResponse.json();
        throw new Error(sessionData.error || 'Failed to create session');
      }

      router.push('/');
    } catch (err: any) {
      console.error('❌ 2FA error:', err.message);
      setError2FA(err.message || '2FA verification failed');
    } finally {
      setLoading2FA(false);
    }
  };

  // 2FA Input View
  if (requires2FA) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <h1 className="text-3xl font-bold text-white mb-2 text-center">Verify with 2FA</h1>
            <p className="text-slate-400 text-center mb-8">
              Enter the code from your authenticator app
            </p>

            {error2FA && (
              <div className="p-4 bg-red-900/30 text-red-300 rounded-lg mb-6 border border-red-700 text-sm">
                ❌ {error2FA}
              </div>
            )}

            <form onSubmit={handle2FASubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Authentication Code
                </label>
                <input
                  type="text"
                  value={twoFACode}
                  onChange={(e) => setTwoFACode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition text-center text-2xl tracking-widest font-mono"
                  disabled={loading2FA}
                  autoFocus
                />
                <p className="text-xs text-slate-400 mt-1">
                  6-digit code from Google Authenticator or Authy
                </p>
              </div>

              <button
                type="submit"
                disabled={loading2FA || twoFACode.length !== 6}
                className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition mt-6"
              >
                {loading2FA ? 'Verifying...' : 'Verify'}
              </button>
            </form>

            <p className="text-center text-slate-400 text-sm mt-6">
              Don&apos;t have access to your authenticator?{' '}
              <button
                onClick={handleBackupCodeFlow}
                disabled={loading2FA}
                className="text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-50"
              >
                Use backup code
              </button>
            </p>

            <button
              onClick={() => {
                setRequires2FA(false);
                setTwoFACode('');
                setError2FA('');
              }}
              className="block text-center mt-6 text-slate-400 hover:text-slate-300 w-full text-sm"
              disabled={loading2FA}
            >
              ← Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Login Form View
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">Log In</h1>
          <p className="text-slate-400 text-center mb-8">Welcome back to Vantage</p>

          {error && (
            <div className="p-4 bg-red-900/30 text-red-300 rounded-lg mb-6 border border-red-700 text-sm">
              ❌ {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
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
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-300">Password</label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  Forgot?
                </Link>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition mt-6"
            >
              {loading ? 'Logging in...' : 'Log In'}
            </button>
          </form>

          <p className="text-center text-slate-400 text-sm mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="text-cyan-400 hover:text-cyan-300 font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
