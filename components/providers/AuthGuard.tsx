// ─── Auth Guard ───────────────────────────────────────────────
// Wraps protected pages. Redirects to /login if no valid session.
// Shows loading screen while isLoading (covers auth check + DB sync).
// Skips public paths (login, login-test) to avoid redirect loops.

'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';

const PUBLIC_PATHS = ['/login', '/login-test'];

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isPublic = PUBLIC_PATHS.includes(pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, isPublic, router]);

  // Public pages render immediately
  if (isPublic) return <>{children}</>;

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
