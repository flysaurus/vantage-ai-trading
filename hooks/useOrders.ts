// ─── useOrders ────────────────────────────────────────────────
// Fetches real order data from the broker adapter.
// Supports filtering by status and order placement.
// Fetches live data from the broker.

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrderStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useAccounts } from '@/context/AccountContext';
import { syncFilledOrders, getTrades } from '@/lib/supabase/trades';
import type { Order } from '@/types';
import type { OrderStatus } from '@/types/broker';

const REFRESH_INTERVAL = 30000; // 30 seconds
const RETRY_DELAY = 3000;

export function useOrders() {
  const { orders, setOrders, addOrder, updateOrder, activeFilter } =
    useOrderStore();
  const { broker, isConnected } = useBroker();
  const { activeAccount } = useAccounts();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hard boundary: when Demo is the active account, NEVER fetch from broker.
  // PortfolioContext will push demo orders into Zustand instead.
  const isShowingDemo = activeAccount?.isDemo ?? false;

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
    // Hard boundary: NEVER fetch broker orders when Demo is the active account
    if (!broker || !isConnected || isShowingDemo) {
      console.error('[useOrders] refresh BLOCKED — broker:', !!broker, 'connected:', isConnected, 'isDemo:', isShowingDemo);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Fetch from three sources in parallel:
      // 1) Broker (SnapTrade recentOrders) — open + recent filled
      // 2) Supabase trade_history — ALL filled orders (no 30-day restriction)
      // 3) public.orders — ALL broker orders persisted by execute-trade route
      const uid = (user?.id as string | undefined) ?? null;
      const [allOpenOrders, filledOrders, tradeHistory, dbOrdersPayload] = await Promise.all([
        broker.getOrders({ status: 'open' }),
        broker
          .getOrders({ status: 'filled', limit: 20 })
          .catch(() => []),
        uid
          ? getTrades(uid, 500, 0).catch(() => ({ trades: [] as any[], total: 0 }))
          : Promise.resolve({ trades: [] as any[], total: 0 }),
        fetch('/api/orders?limit=500').then(r => r.ok ? r.json() : { orders: [] }).catch(() => ({ orders: [] })),
      ]);

      if (!mountedRef.current) return;

      // Map trade_history entries to Order format
      const tradeHistoryOrders: Order[] = (tradeHistory.trades || []).map((trade): Order => ({
        id: trade.id,
        symbol: trade.symbol,
        side: trade.action,
        type: 'market',
        status: 'filled',
        qty: trade.quantity,
        filledQty: trade.quantity,
        filledPrice: trade.price,
        totalValue: trade.totalValue,
        timeInForce: 'day',
        createdAt: trade.executedAt || trade.createdAt,
        updatedAt: trade.createdAt,
      }));

      // Map public.orders entries to Order format
      const dbOrders: Order[] = ((dbOrdersPayload?.orders || []) as any[]).map((o: any): Order => ({
        id: o.id,
        symbol: o.symbol,
        side: (o.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
        type: (o.orderType || 'market') as 'market' | 'limit' | 'stop' | 'stop_limit',
        status: (o.status || 'filled') as Order['status'],
        qty: o.qty || 0,
        filledQty: o.filledQty || 0,
        filledPrice: o.filledPrice,
        totalValue: (o.filledQty || o.qty || 0) * (o.filledPrice || 0),
        timeInForce: (o.timeInForce || 'day') as 'day' | 'gtc' | 'ioc' | 'fok',
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
      }));

      const brokerOrders = [
        ...allOpenOrders,
        ...filledOrders,
      ];

      const mappedBrokerOrders = brokerOrders
        .map(mapToAppOrder);

      // Merge broker orders + trade_history + db orders, deduplicate by ID.
      // Priority: broker > trade_history > public.orders.
      const brokerOrderIds = new Set(mappedBrokerOrders.map(o => o.id));
      const uniqueTradeHistory = tradeHistoryOrders.filter(o => !brokerOrderIds.has(o.id));
      const existingIds = new Set([...brokerOrderIds, ...uniqueTradeHistory.map(o => o.id)]);
      const uniqueDbOrders = dbOrders.filter(o => !existingIds.has(o.id));

      const allOrders = [...mappedBrokerOrders, ...uniqueTradeHistory, ...uniqueDbOrders];

      const mappedOrders = allOrders
        // Deduplicate by ID (safety net)
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

      // ── Merge with existing Zustand orders to preserve immediate adds ──
      // PortfolioContext.executeTrade calls addOrder() instantly, but the order
      // may not yet appear in broker.getOrders() or trade_history. We must not
      // wipe those temp entries. Merging ensures the order survives refresh cycles.
      const currentZustandOrders = useOrderStore.getState().orders;
      const newIds = new Set(mappedOrders.map(o => o.id));
      const orphanOrders = currentZustandOrders.filter(o => !newIds.has(o.id));
      const mergedOrders = [...mappedOrders, ...orphanOrders]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (orphanOrders.length > 0) {
        console.log('[useOrders] Preserved', orphanOrders.length, 'orphan orders from Zustand during refresh:', orphanOrders.map(o => o.id).join(', '));
      }

      console.error('[useOrders] refresh DONE —', mergedOrders.length, 'orders loaded (', mappedBrokerOrders.length, 'from broker +', uniqueTradeHistory.length, 'from trade_history +', uniqueDbOrders.length, 'from db +', orphanOrders.length, 'orphan), symbols:', mergedOrders.map(o => o.symbol).join(', ') || '(none)');
      setOrders(mergedOrders);
      setLoading(false);

      // Sync filled orders to trade_history table (fire-and-forget, deduplicated)
      if (uid && filledOrders.length > 0) {
        syncFilledOrders(
          uid,
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
  }, [broker, isConnected, isShowingDemo, setOrders, user]);

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
    if (isConnected && !isShowingDemo) {
      refresh();
    } else {
      // Demo / no broker: mark loaded, don't touch Zustand orders.
      // PortfolioContext pushes demo orders into Zustand via its sync effect.
      setLoading(false);
      setError(null);
    }
    return () => {
      mountedRef.current = false;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
      }
    };
  }, [isConnected, isShowingDemo, user, refresh, setOrders]);

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
