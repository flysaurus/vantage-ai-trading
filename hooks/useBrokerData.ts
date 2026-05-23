// ─── useBrokerData ─────────────────────────────────────────────
// Unified hook for account, positions, and orders from the broker.
// Uses BrokerProvider context — provides reactive data with
// auto-refresh when market is open.

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBroker } from '@/components/providers/BrokerProvider';
import type {
  BrokerAccount,
  BrokerPosition,
  BrokerOrder,
  MarketStatus,
  OrderStatus,
} from '@/types/broker';

export interface BrokerDataState {
  account: BrokerAccount | null;
  positions: BrokerPosition[];
  orders: BrokerOrder[];
  marketStatus: MarketStatus;
  loading: boolean;
  error: string | null;
}

export interface BrokerDataActions {
  refresh: () => Promise<void>;
  placeOrder: (params: import('@/types/broker').OrderParams) => Promise<BrokerOrder>;
  cancelOrder: (orderId: string) => Promise<void>;
}

const REFRESH_INTERVAL = 30000; // 30 seconds
const RETRY_BASE_DELAY = 2000;
const MAX_RETRY_ATTEMPTS = 3;

export function useBrokerData(): BrokerDataState & BrokerDataActions {
  const { broker, connected } = useBroker();
  const [state, setState] = useState<BrokerDataState>({
    account: null,
    positions: [],
    orders: [],
    marketStatus: { isOpen: false, session: 'closed' },
    loading: true,
    error: null,
  });

  const retryCount = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!broker || !connected) return;

    try {
      setState((s) => ({ ...s, error: null }));

      const [account, positions, orders, marketStatus] =
        await Promise.all([
          broker.getAccount(),
          broker.getPositions(),
          broker.getOrders({ limit: 50 }),
          broker.getMarketStatus(),
        ]);

      if (!mountedRef.current) return;

      // Calculate portfolio percentages for positions
      const totalValue = account.portfolioValue || account.equity || 1;
      const enrichedPositions = positions.map((p) => ({
        ...p,
        portfolioPercent:
          totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0,
      }));

      setState({
        account,
        positions: enrichedPositions,
        orders: orders.filter(
          (o) =>
            o.status === 'new' ||
            o.status === 'pending' ||
            o.status === 'partially_filled'
        ),
        marketStatus,
        loading: false,
        error: null,
      });

      retryCount.current = 0;
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : 'Failed to fetch broker data';

      // Exponential backoff on errors
      if (retryCount.current < MAX_RETRY_ATTEMPTS) {
        const delay =
          RETRY_BASE_DELAY * Math.pow(2, retryCount.current);
        retryCount.current++;
        console.warn(
          `[useBrokerData] Retry ${retryCount.current}/${MAX_RETRY_ATTEMPTS} in ${delay}ms: ${message}`
        );
        setTimeout(() => {
          if (mountedRef.current) refresh();
        }, delay);
      }

      setState((s) => ({
        ...s,
        loading: false,
        error: message,
      }));
    }
  }, [broker, connected]);

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    if (connected) {
      refresh();
    }
    return () => {
      mountedRef.current = false;
    };
  }, [connected, refresh]);

  // Auto-refresh when market is open
  useEffect(() => {
    if (!state.marketStatus.isOpen) return;

    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [state.marketStatus.isOpen, refresh]);

  const placeOrder = useCallback(
    async (
      params: import('@/types/broker').OrderParams
    ): Promise<BrokerOrder> => {
      if (!broker) throw new Error('Broker not connected');

      const order = await broker.placeOrder(params);
      // Optimistically add to orders
      setState((s) => ({
        ...s,
        orders: [order, ...s.orders],
      }));
      return order;
    },
    [broker]
  );

  const cancelOrder = useCallback(
    async (orderId: string): Promise<void> => {
      if (!broker) throw new Error('Broker not connected');
      await broker.cancelOrder(orderId);
      // Optimistically remove
      setState((s) => ({
        ...s,
        orders: s.orders.filter((o) => o.id !== orderId),
      }));
    },
    [broker]
  );

  return {
    ...state,
    refresh,
    placeOrder,
    cancelOrder,
  };
}
