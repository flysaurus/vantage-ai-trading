// ─── Auth Guard ───────────────────────────────────────────────
// Wraps protected pages. Redirects to /login if no valid session.
// Shows loading screen while isLoading (covers auth check + DB sync).
// Skips public paths (login, login-test) to avoid redirect loops.
// Redirects to onboarding if investorStyleOnboarded is false.

'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_PATHS = ['/login', '/login-test'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const {
    isAuthenticated,
    isLoading,
    isDataLoaded,
    profileNotFound,
    error,
    user,
  } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, isPublic, router]);

  // Onboarding — handled by in-app modal overlay on the main page
  // Do NOT redirect to /investor-style for first-time users
  // The onboarding modal in AppShell manages the first-time flow

  // Public pages render immediately
  if (isPublic) return <>{children}</>;

  // DB profile missing — user doesn't exist in our system
  if (profileNotFound) {
    return (
      <div style={{
        height: '100dvh', display: 'flex',
        flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: '#0f172a',
        color: '#e2e8f0', padding: 32, textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>
          {error ? '❌' : '🔐'}
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
          {error ? 'Authentication Failed' : 'Account Not Found'}
        </h2>
        {error && (
          <p style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.5, maxWidth: 360, margin: '0 0 24px', padding: '10px 16px', background: 'rgba(239,68,68,0.1)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </p>
        )}
        {!error && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 360, margin: '0 0 24px' }}>
            Your login is valid but no account data exists in our system.
            This may happen if your account was removed or hasn&apos;t been fully created.
          </p>
        )}
        <button
          onClick={() => {
            import('@/lib/supabase').then(m => m.createClient().auth.signOut());
            window.location.href = '/login';
          }}
          style={{
            padding: '10px 24px', borderRadius: 8,
            border: '1px solid #475569', background: '#1e293b',
            color: '#e2e8f0', cursor: 'pointer', fontSize: 14,
          }}
        >
          Go to Login
        </button>
      </div>
    );
  }

  // Protected — show loading screen while auth + DB sync in progress
  if (isLoading || !isAuthenticated) {
    return (
      <div style={{
        height: '100dvh', display: 'flex',
        flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: '#0f172a',
        color: 'var(--text-muted)',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          border: '3px solid #1e293b',
          borderTopColor: '#06b6d4',
          animation: 'spin 0.8s linear infinite',
          marginBottom: 16,
        }} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>Loading Vantage</div>
        <div style={{ fontSize: 10, marginTop: 4 }}>Syncing your data…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <>{children}</>;
}
