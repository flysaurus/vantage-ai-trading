'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    const verifyEmail = async () => {
      try {
        const token = searchParams.get('token');
        const emailParam = searchParams.get('email');

        if (!token || !emailParam) {
          throw new Error('Invalid verification link');
        }

        const decodedEmail = decodeURIComponent(emailParam);
        setEmail(decodedEmail);

        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: decodedEmail, token }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Email verification failed');
        }

        setSuccess(true);

        setTimeout(() => {
          router.push('/login');
        }, 3000);
      } catch (err: any) {
        setError(err.message || 'Email verification failed');
      } finally {
        setLoading(false);
      }
    };

    verifyEmail();
  }, [searchParams, router]);

  if (loading) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, background: 'rgba(6,182,212,.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <div style={{ width: 32, height: 32, border: '4px solid #1e293b', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>Verifying Email</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Please wait while we verify your email address...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, background: 'rgba(34,197,94,.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <svg style={{ width: 32, height: 32, color: '#22c55e' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>Email Verified!</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 24px' }}>
            Your email <span style={{ color: '#06b6d4', fontWeight: 500 }}>{email}</span> has been verified successfully.
          </p>
          <div style={{ background: 'rgba(30,41,59,.5)', border: '1px solid #334155', borderRadius: 10, padding: 16, marginBottom: 24 }}>
            <p style={{ color: '#cbd5e1', fontSize: 13, margin: 0 }}>You can now log in with your email and password.</p>
          </div>
          <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 24px' }}>Redirecting to login in 3 seconds...</p>
          <Link href="/login" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#06b6d4,#0d9488)', color: '#fff', fontWeight: 600, padding: '10px 24px', borderRadius: 8, textDecoration: 'none', fontSize: 14, transition: 'all .2s' }}>
            Go to Login Now →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, background: 'rgba(248,113,113,.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <svg style={{ width: 32, height: 32, color: '#f87171' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>Verification Failed</h2>
        <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 24px' }}>{error}</p>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '0 0 20px' }}>The verification link may have expired. Try signing up again.</p>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link href="/signup" style={{ flex: 1, background: 'linear-gradient(135deg,#06b6d4,#0d9488)', color: '#fff', fontWeight: 600, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 14, textAlign: 'center', transition: 'all .2s' }}>
            Sign Up Again
          </Link>
          <Link href="/login" style={{ flex: 1, background: '#334155', color: '#fff', fontWeight: 600, padding: '10px 16px', borderRadius: 8, textDecoration: 'none', fontSize: 14, textAlign: 'center', transition: 'all .2s' }}>
            Go to Login
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0e27', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 380, background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, background: 'rgba(6,182,212,.1)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
            <div style={{ width: 32, height: 32, border: '4px solid #1e293b', borderTopColor: '#06b6d4', borderRadius: '50%', animation: 'spin .6s linear infinite' }} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>Verifying Email</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>Loading verification page...</p>
        </div>
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  );
}
