// ─── Broker Context & Provider ────────────────────────────────
// Wraps the app with an initialized broker adapter.
// Components use `useBroker()` — never import specific adapters.

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
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
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!broker) return;

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
        setConnected(true);
      })
      .catch((err) => {
        console.error(`[BrokerProvider] Failed to connect ${brokerId}:`, err);
      });

    return () => {
      broker.disconnect();
      setConnected(false);
    };
  }, [brokerId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BrokerContext.Provider value={{ broker: broker || null, brokerId, connected }}>
      {children}
    </BrokerContext.Provider>
  );
}

export function useBroker(): BrokerContextValue {
  return useContext(BrokerContext);
}
