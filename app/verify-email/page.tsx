'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

type DebugStep = { step: string; status: 'ok' | 'fail' | 'info'; detail: string; time: string };

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');
  const [debug, setDebug] = useState<DebugStep[]>([]);

  const now = () => new Date().toISOString().slice(11, 23);

  const addStep = (step: string, status: 'ok' | 'fail' | 'info', detail: string) => {
    setDebug(prev => [...prev, { step, status, detail, time: now() }]);
  };

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        // Step 1: Read URL params
        const token = searchParams.get('token');
        const emailParam = searchParams.get('email');
        addStep('Read URL params', 'info', `token=${token?.slice(0,12) || 'MISSING'}... email=${emailParam || 'MISSING'}`);

        if (!token || !emailParam) {
          addStep('Validation', 'fail', 'Missing token or email in URL');
          throw new Error('Invalid verification link — missing token or email');
        }

        const decodedEmail = decodeURIComponent(emailParam);
        setEmail(decodedEmail);
        addStep('Decode email', 'ok', `email="${decodedEmail}" token_len=${token.length}`);

        // Step 2: Call API
        addStep('Calling API', 'info', `POST /api/auth/verify-email`);
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: decodedEmail, token }),
        });

        const data = await response.json();
        addStep('API response', response.ok ? 'ok' : 'fail',
          `status=${response.status} ok=${response.ok} body=${JSON.stringify(data).slice(0, 200)}`);

        if (!response.ok) {
          const errEmail = data.verifiedEmail || emailParam;
          throw new Error(`${data.error || 'Email verification failed'} (email used: ${errEmail})`);
        }

        addStep('Verification result', 'ok', `success=${data.success} email=${data.verifiedEmail}`);
        console.log('✅ Email verified');
        setSuccess(true);

        setTimeout(() => {
          router.push('/login');
        }, 3000);
      } catch (err: any) {
        addStep('Error caught', 'fail', err.message);
        console.error('❌ Verification error:', err.message);
        setError(err.message || 'Email verification failed');
      } finally {
        setLoading(false);
      }
    };

    verifyEmail();
  }, [searchParams, router]);

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <div className="w-8 h-8 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin"></div>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Verifying Email</h1>
              <p className="text-slate-400">Please wait while we verify your email address...</p>
              {/* Debug trace visible during loading */}
              <div className="mt-4 text-left border border-slate-700 rounded-lg p-3 bg-slate-950">
                <p className="text-xs text-cyan-400 font-mono mb-2">📋 Debug Trace:</p>
                {debug.map((d, i) => (
                  <div key={i} className="text-xs font-mono mb-1">
                    <span className={d.status === 'ok' ? 'text-green-400' : d.status === 'fail' ? 'text-red-400' : 'text-slate-400'}>
                      [{d.time}] {d.status === 'ok' ? '✅' : d.status === 'fail' ? '❌' : 'ℹ️'} {d.step}
                    </span>
                    <span className="text-slate-500 ml-1">{d.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success State
  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Email Verified!</h1>
              <p className="text-slate-400 mb-6">
                Your email <span className="text-cyan-400 font-medium">{email}</span> has been verified successfully.
              </p>
              <Link href="/login" className="inline-block bg-cyan-500 hover:bg-cyan-600 text-white font-semibold px-6 py-2.5 rounded-lg transition">
                Go to Login Now →
              </Link>
              {/* Debug trace */}
              <div className="mt-4 text-left border border-slate-700 rounded-lg p-3 bg-slate-950">
                <p className="text-xs text-cyan-400 font-mono mb-2">📋 Debug Trace (success):</p>
                {debug.map((d, i) => (
                  <div key={i} className="text-xs font-mono mb-1">
                    <span className={d.status === 'ok' ? 'text-green-400' : d.status === 'fail' ? 'text-red-400' : 'text-slate-400'}>
                      [{d.time}] {d.status === 'ok' ? '✅' : d.status === 'fail' ? '❌' : 'ℹ️'} {d.step}
                    </span>
                    <span className="text-slate-500 ml-1">{d.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error State
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Verification Failed</h1>
            <p className="text-slate-400 mb-2">{error}</p>
            {email && (
              <p className="text-cyan-400 text-xs mb-4">Email being verified: {email}</p>
            )}
            {/* Debug trace */}
            <div className="mt-2 text-left border border-slate-700 rounded-lg p-3 bg-slate-950 mb-4">
              <p className="text-xs text-cyan-400 font-mono mb-2">📋 Debug Trace (error):</p>
              {debug.map((d, i) => (
                <div key={i} className="text-xs font-mono mb-1">
                  <span className={d.status === 'ok' ? 'text-green-400' : d.status === 'fail' ? 'text-red-400' : 'text-slate-400'}>
                    [{d.time}] {d.status === 'ok' ? '✅' : d.status === 'fail' ? '❌' : 'ℹ️'} {d.step}
                  </span>
                  <span className="text-slate-500 ml-1">{d.detail}</span>
                </div>
              ))}
            </div>
            <div className="space-y-3">
              <div className="flex gap-3">
                <Link href="/signup" className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white font-semibold px-4 py-2.5 rounded-lg transition text-center">
                  Sign Up Again
                </Link>
                <Link href="/login" className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-semibold px-4 py-2.5 rounded-lg transition text-center">
                  Go to Login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900 rounded-lg p-8 border border-slate-700">
            <div className="text-center">
              <div className="w-16 h-16 bg-cyan-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <div className="w-8 h-8 border-4 border-slate-700 border-t-cyan-500 rounded-full animate-spin"></div>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Verifying Email</h1>
              <p className="text-slate-400">Loading verification page...</p>
            </div>
          </div>
        </div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
