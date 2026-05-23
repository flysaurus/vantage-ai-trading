// ─── Broker Context & Provider ────────────────────────────────
// Wraps the app with an initialized broker adapter.
// Components use `useBroker()` — never import specific adapters.

'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { BrokerAdapter, BrokerConfig, BrokerId } from '@/types/broker';
import { brokerRegistry, setActiveBroker } from '@/lib/broker';

interface BrokerContextValue {
  broker: BrokerAdapter | null;
  brokerId: BrokerId;
  connected: boolean;
}

const BrokerContext = createContext<BrokerContextValue>({
  broker: null,
  brokerId: 'alpaca',
  connected: false,
});

export function BrokerProvider({
  brokerId = 'alpaca',
  config,
  children,
}: {
  brokerId?: BrokerId;
  config?: Partial<BrokerConfig>;
  children: React.ReactNode;
}) {
  const broker = brokerRegistry.get(brokerId);
  const connectedRef = useRef(false);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current || !broker) return;
    initRef.current = true;

    // In production, config comes from server via vault. For dev, env vars.
    const fullConfig: BrokerConfig = {
      id: brokerId,
      name: broker.name,
      environment: 'paper',
      baseUrl: config?.baseUrl,
      extra: config?.extra,
      ...config,
    };

    broker
      .connect(fullConfig)
      .then(() => {
        setActiveBroker(brokerId);
        connectedRef.current = true;
      })
      .catch((err) => {
        console.error(`[BrokerProvider] Failed to connect ${brokerId}:`, err);
      });

    return () => {
      broker.disconnect();
      connectedRef.current = false;
    };
  }, [brokerId]);

  return React.createElement(
    BrokerContext.Provider,
    { value: { broker: broker || null, brokerId, connected: connectedRef.current } },
    children
  );
}

export function useBroker(): BrokerContextValue {
  return useContext(BrokerContext);
}
