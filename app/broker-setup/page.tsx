'use client';

// ─── /broker-setup ────────────────────────────────────────
// Standalone route for broker connections.
// Navigated to from Settings → "Manage"/"Connect →" and from the account
// picker → "Add a broker". Each entry carries `?from=<origin>` so Back returns
// the user to the surface they actually came from (Settings vs the picker)
// instead of always landing on Settings.
// Cold entries (OAuth callback redirects, deep links) keep the Settings default.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrokerConnectionsPage } from '@/components/broker/BrokerConnectionsPage';
import {
  brokerConnectionsBackPath,
  parseBrokerConnOrigin,
  type BrokerConnOrigin,
} from '@/lib/broker-connections/origin';

export default function BrokerSetupPage() {
  const router = useRouter();

  // Read once, synchronously, on the client (this value is never rendered, so
  // there is no hydration-mismatch concern). SSR → null = cold entry.
  const [origin] = useState<BrokerConnOrigin | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseBrokerConnOrigin(
      new URLSearchParams(window.location.search).get('from'),
    );
  });

  const goBack = () => router.push(brokerConnectionsBackPath(origin));

  return (
    <BrokerConnectionsPage
      onBack={goBack}
      onEnterApp={() => router.push('/')}
      onDisconnect={async () => {
        await fetch('/api/broker/disconnect', { method: 'POST', credentials: 'include' });
        goBack();
      }}
    />
  );
}
