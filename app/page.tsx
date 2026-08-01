// ─── Root Page — Routing Layer ──────────────────────────────
// Single routing decision. useAppState is the ONLY place
// session is checked. Zero competing logic elsewhere.

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/app-state';
import { VantageOrb } from '@/components/brand/VantageOrb';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import MainApp from '@/components/app/MainApp';
import { BrokerChoicePage } from '@/components/broker/BrokerChoicePage';
import { BrokerConnectionsPage } from '@/components/broker/BrokerConnectionsPage';
import { ConnectionLoadingPage } from '@/components/broker/ConnectionLoadingPage';

export default function Page() {
  const { state, profile, refreshState } = useAppState();
  const router = useRouter();

  // Guard against repeated redirects — only run once per mount
  const redirectedToSetup = useRef(false);

  // Manual override: show broker connections page (from demo counter button)

  // needs-profile: redirect to onboarding
  useEffect(() => {
    if (state !== 'needs-profile') return;
    if (redirectedToSetup.current) return;
    redirectedToSetup.current = true;
    router.push('/onboarding');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

  // Debug banner — shows current state, profile fields, and raw cookies
  const showDebug = false; // ← toggle off after debugging
  const [cookieDebug, setCookieDebug] = useState('…');
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const names = document.cookie.split(';')
        .map(c => c.trim().split('=')[0])
        .filter(Boolean)
        .join(', ');
      const sbCookies = names.toLowerCase().includes('sb-') ? '🍪 AUTH' : '❌ NOAUTH';
      setCookieDebug(sbCookies + ' | ' + (names || '(none)'));
    }
  }, [state]);
  const debugBanner = showDebug ? (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: '#0a0', color: '#fff', padding: '8px 16px',
      fontSize: '12px', fontFamily: 'monospace', opacity: 0.9,
      pointerEvents: 'none', display: 'flex', gap: '16px', flexWrap: 'wrap',
    }}>
      <span>STATE: <b>{state}</b></span>
      <span>COOKIES: <b>{cookieDebug}</b></span>
      <span>NAME: <b>{profile?.first_name || '—'} {profile?.last_name || ''}</b></span>
      <span>STYLE: <b>{profile?.investor_style || '—'}</b></span>
      <span>DEMO_START: <b>{profile?.demo_start_at ? '✅' : '❌'}</b></span>
      <span>ONBOARDED: <b>{profile?.investor_style_onboarded ? '✅' : '❌'}</b></span>
      <span>CONNECTION: <b>{profile?.connection_type || '—'}</b></span>
      <span>BUILD: <b>710c938</b></span>
    </div>
  ) : null;

  // loading: show minimal orb pulse
  if (state === 'loading') {
    return (
      <>
        {debugBanner}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}>
          <VantageOrb size={44} animate={true} />
        </div>
      </>
    );
  }

  // onboarding: brand new user — full onboarding flow
  if (state === 'onboarding') {
    return <>{debugBanner}<OnboardingFlow /></>;
  }

  // needs-profile: redirect handled by useEffect above
  if (state === 'needs-profile') {
    return (
      <>
        {debugBanner}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--bg-primary)',
        }}>
          <VantageOrb size={44} animate={true} />
        </div>
      </>
    );
  }

  // needs-quiz: has account + profile, just needs style quiz
  if (state === 'needs-quiz') {
    return <>{debugBanner}<OnboardingFlow initialScreen="quiz" /></>;
  }

  // broker-selection: authenticated but neither demo nor broker chosen
  if (state === 'broker-selection') {
    return <>{debugBanner}<BrokerChoicePage onStateChanged={refreshState} /></>;
  }

  // connection-options: chose to connect a broker — show unified broker connections page
  if (state === 'connection-options') {
    return (
      <>
        {debugBanner}
        <BrokerConnectionsPage
          onBack={refreshState}
          onEnterApp={refreshState}
          onDisconnect={async () => {
            await fetch('/api/broker/disconnect', { method: 'POST', credentials: 'include' });
            refreshState();
          }}
        />
      </>
    );
  }

  // connection-loading: broker syncing — animated spinner + polling
  if (state === 'connection-loading') {
    return <>{debugBanner}<ConnectionLoadingPage profile={profile} onStateChanged={refreshState} /></>;
  }

  // demo-counter (dismissed) / authenticated
  return <>{debugBanner}<MainApp /></>;
}
