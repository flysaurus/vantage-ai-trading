// ─── Root Page — Routing Layer ──────────────────────────────
// Single routing decision. useAppState is the ONLY place
// session is checked. Zero competing logic elsewhere.

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/app-state';
import { BootSplash } from '@/components/onboarding/BootSplash';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import MainApp from '@/components/app/MainApp';
import { BrokerChoicePage } from '@/components/broker/BrokerChoicePage';
import { ConnectionOptionsPage } from '@/components/broker/ConnectionOptionsPage';
import { ConnectionLoadingPage } from '@/components/broker/ConnectionLoadingPage';
import { DemoCounterPage } from '@/components/demo/DemoCounterPage';
import { DemoExpired } from '@/components/app/DemoExpired';

export default function Page() {
  const { state, profile } = useAppState();
  const router = useRouter();

  // Dismiss state for demo-counter (transient, not persisted)
  const [showDemoCounter, setShowDemoCounter] = useState(true);
  useEffect(() => {
    if (state === 'demo-counter') setShowDemoCounter(true);
  }, [state]);

  // needs-profile: redirect to profile completion
  useEffect(() => {
    if (state === 'needs-profile') {
      router.push('/auth/complete');
    }
  }, [state, router]);

  // loading: show boot splash
  if (state === 'loading') {
    return <BootSplash onComplete={() => {}} />;
  }

  // onboarding: brand new user — full onboarding flow
  if (state === 'onboarding') {
    return <OnboardingFlow />;
  }

  // needs-profile: redirect to auth/complete
  if (state === 'needs-profile') {
    return <BootSplash onComplete={() => {}} />;
  }

  // needs-quiz: has account + profile, just needs style quiz
  if (state === 'needs-quiz') {
    return <OnboardingFlow initialScreen="quiz" />;
  }

  // broker-selection: authenticated but neither demo nor broker chosen
  if (state === 'broker-selection') {
    return <BrokerChoicePage />;
  }

  // demo-counter: demo active — show counter, dismiss to MainApp
  if (state === 'demo-counter' && showDemoCounter) {
    return (
      <DemoCounterPage
        profile={profile}
        onEnter={() => setShowDemoCounter(false)}
      />
    );
  }

  // demo-expired: 30-day demo has elapsed
  if (state === 'demo-expired') {
    return <DemoExpired />;
  }

  // connection-options: chose to connect a broker — show broker options
  if (state === 'connection-options') {
    return <ConnectionOptionsPage />;
  }

  // connection-loading: broker syncing — animated spinner + polling
  if (state === 'connection-loading') {
    return <ConnectionLoadingPage profile={profile} />;
  }

  // demo-counter (dismissed) / authenticated
  return <MainApp />;
}
