'use client';

// ─── /broker-setup ────────────────────────────────────────
// Standalone route for broker connections.
// Navigated to from Settings → "Connect →" and anywhere else
// that prompts the user to connect a broker.

import { useRouter } from 'next/navigation';
import { BrokerConnectionsPage } from '@/components/broker/BrokerConnectionsPage';

export default function BrokerSetupPage() {
  const router = useRouter();

  return (
    <BrokerConnectionsPage
      onBack={() => router.push(`/?tab=settings`)}
      onEnterApp={() => router.push('/')}
      onDisconnect={async () => {
        await fetch('/api/broker/disconnect', { method: 'POST', credentials: 'include' });
        router.push(`/?tab=settings`);
      }}
    />
  );
}
