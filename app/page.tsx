// ─── Root Page — Routing Layer ──────────────────────────────
// Single routing decision. useAppState is the ONLY place
// session is checked. Zero competing logic elsewhere.
//
// ALL hooks called unconditionally at top.
// ALL conditional returns AFTER all hooks.
// This eliminates React #310 (hook order violations) forever.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/lib/app-state';
import { BootSplash } from '@/components/onboarding/BootSplash';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';
import MainApp from '@/components/app/MainApp';

export default function Page() {
  // ALL hooks unconditionally at top — never after returns
  const { state } = useAppState();
  const router = useRouter();

  // needs-profile: redirect to profile completion
  useEffect(() => {
    if (state === 'needs-profile') {
      router.push('/auth/complete');
    }
  }, [state, router]);

  // ALL conditional returns AFTER all hooks
  if (state === 'loading') {
    return <BootSplash onComplete={() => {}} />;
  }

  if (state === 'onboarding') {
    return <OnboardingFlow />;
  }

  if (state === 'needs-profile') {
    return <BootSplash onComplete={() => {}} />;
  }

  return <MainApp />;
}
