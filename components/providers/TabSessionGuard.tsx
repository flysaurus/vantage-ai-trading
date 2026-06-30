// ─── TabSessionGuard — Tab-close = logout ─────────────────────
// On mount, checks if this is a fresh browser tab. If it is
// and a Supabase session cookie exists, signs out immediately.
// This ensures closing ALL tabs = fully logged out.
//
// Mounted in app/layout.tsx, wraps children.

'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { VantageOrb } from '@/components/brand/VantageOrb';

export function TabSessionGuard({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Check if this is a fresh tab
    const tabActive = sessionStorage.getItem('vantage_tab_active');

    if (!tabActive) {
      // New tab — mark it active
      sessionStorage.setItem('vantage_tab_active', '1');

      // If there's a stale session cookie, sign out and reload
      if (document.cookie.includes('sb-')) {
        import('@/lib/auth/supabase-client').then(
          ({ getSupabaseBrowserClient }) => {
            getSupabaseBrowserClient()
              .auth.signOut()
              .finally(() => {
                // Clear all cookies on this domain
                document.cookie.split(';').forEach((c) => {
                  const name = c.trim().split('=')[0];
                  document.cookie =
                    name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
                });
                window.location.href = '/';
              });
          }
        );
        return; // Don't set ready — page will redirect
      }
    }

    setReady(true);
  }, []);

  if (!ready) {
    // Show minimal orb pulse while signing out
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0a0f1e',
        }}
      >
        <VantageOrb size={44} animate={true} />
      </div>
    );
  }

  return <>{children}</>;
}
