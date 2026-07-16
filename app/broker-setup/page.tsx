'use client';

// ─── /broker-setup ────────────────────────────────────────
// Standalone route for the broker connection coming-soon screen.
// Navigated to from Settings → "Connect →" and anywhere else
// that prompts the user to connect a broker.

import { useRouter } from 'next/navigation';
import { ConnectionOptionsPage } from '@/components/broker/ConnectionOptionsPage';

export default function BrokerSetupPage() {
  const router = useRouter();

  return (
    <ConnectionOptionsPage
      onStateChanged={() => router.push(`/?tab=settings`)}
    />
  );
}
