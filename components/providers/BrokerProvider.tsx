// ─── Broker Context & Provider ────────────────────────────────
// Wraps the app with an initialized broker adapter.
// Components use `useBroker()` — never import specific adapters.
//
// On mount: calls GET /api/broker/status to discover connected broker.
// If connected: initializes the correct adapter (Alpaca, Tastytrade, etc.).
// If not connected: exposes isConnected: false, brokerId: null.

'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { BrokerAdapter, BrokerConfig, BrokerId } from '@/types/broker';
import { brokerRegistry, setActiveBroker } from '@/lib/broker';
import { apiGet } from '@/lib/api-client';

interface BrokerContextValue {
  broker: BrokerAdapter | null;
  brokerId: BrokerId | null;
  isConnected: boolean;
  /** True once the initial /api/broker/status check has completed (even if no broker). */
  isInitialized: boolean;
  accountPreview: {
    id: string;
    equity: number;
    buyingPower: number;
    status: string;
  } | null;
  environment: string | null;
}

const BrokerContext = createContext<BrokerContextValue>({
  broker: null,
  brokerId: null,
  isConnected: false,
  isInitialized: false,
  accountPreview: null,
  environment: null,
});

export function BrokerProvider({ children }: { children: React.ReactNode }) {
  const [broker, setBroker] = useState<BrokerAdapter | null>(null);
  const [brokerId, setBrokerId] = useState<BrokerId | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [accountPreview, setAccountPreview] = useState<BrokerContextValue['accountPreview']>(null);
  const [environment, setEnvironment] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Discover broker on mount: check /api/broker/status
  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await apiGet('/api/broker/status');

        // 401: no valid token — broker not connected, that's fine
        if (res.status === 401) {
          if (!cancelled) setInitialized(true);
          return;
        }

        if (!res.ok) {
          if (!cancelled) setInitialized(true);
          return;
        }

        const data = await res.json();

        if (cancelled) return;

        if (data.connected && data.brokerId) {
          const adapter = brokerRegistry.get(data.brokerId as BrokerId);
          if (adapter) {
            const underlyingBroker = data.accountPreview?.provider
              || data.accountPreview?.id as string
              || '';
            const config: BrokerConfig = {
              id: data.brokerId,
              name: adapter.name,
              environment: data.environment || 'paper',
              extra: underlyingBroker ? { brokerId: underlyingBroker } : undefined,
            };

            try {
              await adapter.connect(config);
              setActiveBroker(data.brokerId);
              setBroker(adapter);
              setBrokerId(data.brokerId);
              setIsConnected(true);
              setAccountPreview(data.accountPreview || null);
              setEnvironment(data.environment || null);
            } catch (err) {
              console.error(`[BrokerProvider] Failed to connect ${data.brokerId}:`, err);
              setIsConnected(false);
              setBrokerId(null);
            }
          }
        } else {
          setIsConnected(false);
          setBrokerId(null);
          setBroker(null);
        }

        setInitialized(true);
      } catch (err) {
        console.error('[BrokerProvider] Status check failed:', err);
        if (!cancelled) {
          setIsConnected(false);
          setBrokerId(null);
          setInitialized(true);
        }
      }
    }

    checkStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (broker) {
        broker.disconnect();
      }
    };
  }, [broker]);

  // Periodically refresh account preview (only when connected)
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(async () => {
      try {
        const res = await apiGet('/api/broker/status');
        if (res.status === 401) return; // token expired, apiGet will redirect
        if (res.ok) {
          const data = await res.json();
          if (data.connected && data.accountPreview) {
            setAccountPreview(data.accountPreview);
            setEnvironment(data.environment || null);
            setTradingEnabled(data.trading_enabled !== false);
          }
        }
      } catch (err) {
        // Silently ignore — will retry next interval
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <BrokerContext.Provider
      value={{
        broker,
        brokerId,
        isConnected,
        isInitialized: initialized,
        tradingEnabled,
        accountPreview,
        environment,
      }}
    >
      {children}
    </BrokerContext.Provider>
  );
}

export function useBroker(): BrokerContextValue {
  return useContext(BrokerContext);
}
