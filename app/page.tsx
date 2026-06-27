// ─── Root Page — Routing Layer ──────────────────────────────
// Single routing decision. useAppState is the ONLY place
// session is checked. Zero competing logic elsewhere.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/app-state';
import { BootSplash } from '@/components/onboarding/BootSplash';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import MainApp from '@/components/app/MainApp';
import { BrokerSelection } from '@/components/app/BrokerSelection';
import { DemoExpired } from '@/components/app/DemoExpired';

export default function Page() {
  const { state } = useAppState();
  const router = useRouter();

  // needs-profile: redirect to profile completion
  useEffect(() => {
    if (state === 'needs-profile') {
      router.push('/auth/complete');
    }
  }, [state, router]);

  // needs-quiz: full profile except quiz — send straight to quiz

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

  // broker-selection: authenticated but demo not started yet
  if (state === 'broker-selection') {
    return <BrokerSelection />;
  }

  // demo-expired: 30-day demo has elapsed
  if (state === 'demo-expired') {
    return <DemoExpired />;
  }

  return <MainApp />;
}
