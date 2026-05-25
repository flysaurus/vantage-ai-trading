// ─── Auth Guard ───────────────────────────────────────────────
// Wraps protected pages. Redirects to /login if no valid session.
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

  // Protected — show nothing while loading or redirecting
  if (isLoading || !isAuthenticated) return null;

  return <>{children}</>;
}
