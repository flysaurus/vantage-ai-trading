// ─── useOrders ────────────────────────────────────────────────
// Fetches real order data from the broker adapter.
// Supports filtering by status and order placement.
// Fetches live data from the broker.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrderStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { syncFilledOrders } from '@/lib/supabase/trades';
import type { Order } from '@/types';
import type { OrderStatus } from '@/types/broker';

const REFRESH_INTERVAL = 30000; // 30 seconds
const RETRY_DELAY = 3000;

export function useOrders() {
  const { orders, setOrders, addOrder, updateOrder, activeFilter } =
    useOrderStore();
  const { broker, connected } = useBroker();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Map broker OrderStatus to app OrderStatus
  const statusMap: Record<string, Order['status']> = {
    new: 'open',
    pending: 'pending',
    filled: 'filled',
    partially_filled: 'open',
    cancelled: 'cancelled',
    rejected: 'rejected',
    expired: 'cancelled',
  };

  const mapToAppOrder = (
    raw: import('@/types/broker').BrokerOrder
  ): Order => ({
    id: raw.id,
    symbol: raw.symbol,
    side: raw.side,
    type: raw.type,
    status: statusMap[raw.status] || 'open',
    qty: raw.qty,
    filledQty: raw.filledQty,
    limitPrice: raw.limitPrice,
    stopPrice: raw.stopPrice,
    filledPrice: raw.filledPrice,
    totalValue: raw.totalValue,
    timeInForce: raw.timeInForce,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    bracketOrder: raw.bracketOrder
      ? {
          stopLoss: raw.bracketOrder.stopLoss?.stopPrice,
          takeProfit: raw.bracketOrder.takeProfit?.limitPrice,
        }
      : undefined,
  });

  const refresh = useCallback(async (): Promise<void> => {
    if (!broker || !connected) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch all order statuses in one call
      const [allOpenOrders, filledOrders] = await Promise.all([
        broker.getOrders({ status: 'open' }),
        broker
          .getOrders({ status: 'filled', limit: 20 })
          .catch(() => []),
      ]);

      if (!mountedRef.current) return;

      const allOrders = [
        ...allOpenOrders,
        ...filledOrders,
      ];

      const mappedOrders = allOrders
        .map(mapToAppOrder)
        // Deduplicate by ID
        .filter(
          (order, idx, arr) =>
            arr.findIndex((o) => o.id === order.id) === idx
        )
        // Sort by creation date, newest first
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() -
            new Date(a.createdAt).getTime()
        );

      setOrders(mappedOrders);
      setLoading(false);

      // Sync filled orders to trade_history table (fire-and-forget, deduplicated)
      if (user?.id && filledOrders.length > 0) {
        syncFilledOrders(
          user.id,
          filledOrders.map(o => ({
            id: o.id,
            symbol: o.symbol,
            side: o.side as 'buy' | 'sell',
            filledQty: o.filledQty,
            filledPrice: o.filledPrice ?? 0,
            createdAt: o.createdAt,
          })),
        ).catch(() => {/* fire-and-forget: errors are logged in createTrade */});
      }
    } catch (err) {
      if (!mountedRef.current) return;

      const message =
        err instanceof Error ? err.message : 'Failed to load orders';
      console.error('[useOrders] Error:', message);
      setError(message);
      setLoading(false);

      // Retry
      retryTimer.current = setTimeout(() => {
        if (mountedRef.current) refresh();
      }, RETRY_DELAY);
    }
  }, [broker, connected, setOrders]);

  const placeOrder = useCallback(
    async (
      params: import('@/types/broker').OrderParams
    ): Promise<Order> => {
      if (!broker) throw new Error('Broker not connected');

      const result = await broker.placeOrder(params);
      const appOrder = mapToAppOrder(result);

      addOrder(appOrder);
      return appOrder;
    },
    [broker, addOrder]
  );

  const cancelOrder = useCallback(
    async (orderId: string): Promise<void> => {
      if (!broker) throw new Error('Broker not connected');

      await broker.cancelOrder(orderId);
      updateOrder(orderId, { status: 'cancelled' });
    },
    [broker, updateOrder]
  );

  // Initial load
  useEffect(() => {
    mountedRef.current = true;
    if (connected) {
      refresh();
    }
    return () => {
      mountedRef.current = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
    };
  }, [connected, refresh]);

  // Periodic refresh for active orders
  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [refresh]);

  // Filter orders based on active filter
  const filteredOrders =
    activeFilter === 'all'
      ? orders
      : orders.filter((o) => {
          if (activeFilter === 'open') return o.status === 'open' || o.status === 'pending';
          return o.status === activeFilter;
        });

  return {
    orders: filteredOrders,
    allOrders: orders,
    loading,
    error,
    refresh,
    placeOrder,
    cancelOrder,
    activeFilter,
  };
}
