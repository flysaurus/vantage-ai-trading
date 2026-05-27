'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    console.log('👉 [SIGNUP] Attempting signup:', email);

    try {
      if (!email || !password) {
        throw new Error('Email and password required');
      }

      if (password.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }

      if (!email.includes('@')) {
        throw new Error('Please enter a valid email');
      }

      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, displayName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      console.log('✅ Signup successful');

      setSuccess(true);
      setVerificationMessage(
        `Verification email sent to ${email}. Please check your inbox and click the verification link.`
      );

      setEmail('');
      setPassword('');
      setDisplayName('');

      setTimeout(() => {
        router.push('/login');
      }, 5000);
    } catch (err: any) {
      console.error('❌ Signup error:', err.message);
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Account Created!</h1>
              <p className="text-slate-400">Check your email to verify your account</p>
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 mb-6">
              <p className="text-slate-300 text-sm">{verificationMessage}</p>
            </div>

            <div className="text-center text-sm text-slate-400">
              <p>Redirecting to login in 5 seconds...</p>
            </div>

            <Link href="/login" className="block text-center mt-6 text-cyan-400 hover:text-cyan-300 font-medium">
              Go to Login Now →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">Create Account</h1>
          <p className="text-slate-400 text-center mb-8">
            Join Vantage and start AI-powered trading
          </p>

          {error && (
            <div className="p-4 bg-red-900/30 text-red-300 rounded-lg mb-6 border border-red-700 text-sm">
              ❌ {error}
            </div>
          )}

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Full Name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="John Doe"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-800 text-white px-4 py-2.5 rounded-lg border border-slate-700 focus:border-cyan-500 focus:outline-none transition"
                disabled={loading}
                required
              />
              <p className="text-xs text-slate-400 mt-1">At least 8 characters</p>
            </div>

            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs font-medium text-slate-300 mb-2">Password requirements:</p>
              <ul className="text-xs text-slate-400 space-y-1">
                <li className={password.length >= 8 ? 'text-green-400' : ''}>
                  ✓ At least 8 characters
                </li>
                <li className={/[A-Z]/.test(password) ? 'text-green-400' : ''}>
                  ✓ One uppercase letter
                </li>
                <li className={/[0-9]/.test(password) ? 'text-green-400' : ''}>
                  ✓ One number
                </li>
                <li className={/[!@#$%^&*]/.test(password) ? 'text-green-400' : ''}>
                  ✓ One special character (!@#$%^&*)
                </li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-cyan-500 hover:bg-cyan-600 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition mt-6"
            >
              {loading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center text-slate-400 text-sm mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">
              Log in
            </Link>
          </p>

          <p className="text-center text-xs text-slate-500 mt-6">
            By creating an account, you agree to our Terms of Service and Privacy Policy
          </p>
        </div>
      </div>
    </div>
  );
}
