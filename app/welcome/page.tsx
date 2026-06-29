// ─── /welcome — Redirect to /you-are-in ──────────────────────
// All setup now happens server-side in /auth/complete/route.ts
// where the session is guaranteed. This page just redirects.

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WelcomePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/you-are-in');
  }, [router]);

  return null;
}
