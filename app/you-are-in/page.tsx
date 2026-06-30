// ─── /you-are-in — Post-setup celebration page ──────────────
// Pure animation. No data fetching, no API calls.
// Session is guaranteed — setup already completed in /auth/complete.
// Auto-advances to / after 3 seconds.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VantageOrb } from '@/components/brand/VantageOrb';

export default function YouAreInPage() {
  const router = useRouter();
  const [cookieInfo, setCookieInfo] = useState('…');

  useEffect(() => {
    // Debug: check if cookies arrived
    const hasCookies = document.cookie.length > 0;
    console.log('[you-are-in] page loaded, document.cookie length:', document.cookie.length,
      'cookies:', document.cookie.split(';').map(c => c.trim().split('=')[0]).join(', '));
    setCookieInfo(hasCookies ? `🍪 ${document.cookie.split(';').length} cookies` : '❌ no cookies');

    const timer = setTimeout(() => {
      router.push('/');
    }, 3000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        background: 'var(--bg-primary)',
        gap: '24px',
      }}
    >
      <VantageOrb size={180} animate showEntrance />

      <div style={{ textAlign: 'center' }}>
        <h1
          style={{
            fontFamily: 'Inter, var(--font-sans)',
            fontWeight: 800,
            fontSize: '48px',
            color: 'white',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          You&apos;re
        </h1>
        <h1
          style={{
            fontFamily: "'Playfair Display', var(--font-serif)",
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: '48px',
            color: 'white',
            margin: 0,
            lineHeight: 1.1,
          }}
        >
          in.
        </h1>
      </div>

      <p
        style={{
          fontFamily: 'Inter, var(--font-sans)',
          fontWeight: 400,
          fontSize: '16px',
          color: 'rgba(255,255,255,0.6)',
          margin: 0,
        }}
      >
        Setting up your portfolio...
      </p>

      <p style={{
        fontFamily: 'monospace',
        fontSize: '11px',
        color: 'rgba(255,255,255,0.35)',
        margin: 0,
      }}>
        {cookieInfo}
      </p>
    </div>
  );
}
