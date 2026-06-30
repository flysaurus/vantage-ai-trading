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
import { ConnectionOptionsPage } from '@/components/broker/ConnectionOptionsPage';
import { ConnectionLoadingPage } from '@/components/broker/ConnectionLoadingPage';
import { DemoCounterPage } from '@/components/demo/DemoCounterPage';
import { DemoExpired } from '@/components/app/DemoExpired';

export default function Page() {
  const { state, profile, refreshState } = useAppState();
  const router = useRouter();

  // Guard against repeated redirects — only run once per mount
  const redirectedToSetup = useRef(false);

  // ── DEBUG BANNER — remove after debugging ──
  const [cookieDebug, setCookieDebug] = useState('');
  useEffect(() => {
    const c = document.cookie;
    const hasSb = c.indexOf('sb-') !== -1;
    setCookieDebug(
      hasSb
        ? `COOKIE: ✅ (${c.length} chars)`
        : `COOKIE: ❌ NONE (len=${c.length})`
    );
  }, []);
  const debugBanner = (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647,
      background: 'rgba(0,0,0,0.95)', color: '#0f0', padding: '6px 12px',
      fontSize: '11px', fontFamily: 'monospace', lineHeight: 1.4,
      borderBottom: '1px solid #333',
      pointerEvents: 'none'
    }}>
      STATE: <strong>{state}</strong> | 
      {cookieDebug} | 
      NAME: {profile?.first_name ?? 'null'} {profile?.last_name ?? 'null'} | 
      STYLE: {profile?.investor_style ?? 'null'} | 
      DEMO_START: {profile?.demo_start_at ? '✅' : '❌ NULL'} | 
      ONBOARDED: {profile?.investor_style_onboarded ? '✅' : '❌'}
    </div>
  );

  // Dismiss state for demo-counter (transient, not persisted)
  const [showDemoCounter, setShowDemoCounter] = useState(true);
  useEffect(() => {
    if (state === 'demo-counter') setShowDemoCounter(true);
  }, [state]);

  // needs-profile: redirect to onboarding
  useEffect(() => {
    if (state !== 'needs-profile') return;
    if (redirectedToSetup.current) return;
    redirectedToSetup.current = true;
    router.push('/onboarding');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, router]);

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

  // demo-counter: demo active — show counter, dismiss to MainApp
  if (state === 'demo-counter' && showDemoCounter) {
    return (
      <>
        {debugBanner}
        <DemoCounterPage
          profile={profile}
          onEnter={() => setShowDemoCounter(false)}
        />
      </>
    );
  }

  // demo-expired: 30-day demo has elapsed
  if (state === 'demo-expired') {
    return <>{debugBanner}<DemoExpired /></>;
  }

  // connection-options: chose to connect a broker — show broker options
  if (state === 'connection-options') {
    return <>{debugBanner}<ConnectionOptionsPage onStateChanged={refreshState} /></>;
  }

  // connection-loading: broker syncing — animated spinner + polling
  if (state === 'connection-loading') {
    return <>{debugBanner}<ConnectionLoadingPage profile={profile} onStateChanged={refreshState} /></>;
  }

  // demo-counter (dismissed) / authenticated
  return <>{debugBanner}<MainApp /></>;
}
