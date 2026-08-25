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
import { isWorkingStatus } from '@/lib/order-format';
import type { Order } from '@/types';
import type { OrderStatus } from '@/types/broker';

const REFRESH_INTERVAL = 30000; // 30 seconds
const RETRY_DELAY = 3000;

/** Outcome of a cancel attempt — lets the UI surface the cancel-race result. */
export type CancelOutcome =
  | { cancelled: true }
  | { alreadyFilled: true; fillPrice?: number; filledQty?: number }
  | { alreadyTerminal: true; status: Order['status'] };

export function useOrders() {
  const { orders, setOrders, addOrder, updateOrder, activeFilter } =
    useOrderStore();
  const { broker, isConnected } = useBroker();
  const { activeAccount, activeAccountId } = useAccounts();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baskets, setBaskets] = useState<any[]>([]);

  const mountedRef = useRef(true);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hard boundary: when Demo is the active account, NEVER fetch from broker.
  // PortfolioContext will push demo orders into Zustand instead.
  const isShowingDemo = activeAccount?.isDemo ?? false;

  // broker_connections.id for the active live account ('' for demo)
  const liveConnectionId = activeAccountId?.startsWith('snaptrade:')
    ? activeAccountId.slice('snaptrade:'.length)
    : null;

  // Map broker OrderStatus to app OrderStatus
  const statusMap: Record<string, Order['status']> = {
    new: 'open',
    pending: 'pending',
    submitted: 'submitted',
    open: 'open',
    filled: 'filled',
    partially_filled: 'open',
    cancelled: 'cancelled',
    rejected: 'rejected',
    expired: 'cancelled',
  };

  // Accept any broker order shape — at runtime the broker returns lib/broker/types.BrokerOrder
  // (shares, submittedAt, totalCost) but BrokerAdapter types it as types/broker.BrokerOrder
  // (qty, createdAt, totalValue). We read runtime-safe fields to bridge the gap.
  const mapToAppOrder = (
    raw: Record<string, any>
  ): Order => ({
    id: raw.id,
    symbol: raw.symbol,
    side: (typeof raw.side === 'string' ? raw.side.toLowerCase() : raw.side) as Order['side'],
    type: raw.type,
    status: statusMap[(typeof raw.status === 'string' ? raw.status.toLowerCase() : raw.status)] || 'open',
    qty: raw.shares ?? raw.qty ?? 0,
    filledQty: raw.filledQty ?? raw.filledShares ?? 0,
    limitPrice: raw.limitPrice,
    stopPrice: raw.stopPrice,
    filledPrice: raw.fillPrice ?? raw.filledPrice,
    totalValue: raw.totalCost ?? raw.totalValue ?? 0,
    timeInForce: raw.timeInForce || 'day',
    createdAt: raw.submittedAt ?? raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.submittedAt ?? raw.updatedAt ?? raw.createdAt,
    filledAt: raw.filledAt ?? raw.filled_at ?? null,
    cancelledAt: raw.cancelledAt ?? raw.cancelled_at ?? null,
    cancelReason: raw.cancelReason ?? raw.cancel_reason ?? null,
    source: raw.source ?? raw.origin ?? null,
    notional: raw.notional ?? null,
    orderUnit: raw.orderUnit ?? raw.order_unit ?? undefined,
    requestedAmount: raw.requestedAmount ?? raw.requested_amount ?? null,
    requestedQty: raw.requestedQty ?? raw.requested_qty ?? null,
    brokerageOrderId: raw.brokerageOrderId ?? raw.brokerage_order_id ?? raw.id,
    companyName: raw.companyName ?? raw.company_name ?? null,
    basketId: raw.basketId ?? raw.basket_id ?? null,
    basketName: raw.basketName ?? raw.basket_name ?? null,
    basketEmoji: raw.basketEmoji ?? raw.basket_emoji ?? null,
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
          ? getTrades(uid, 500, 0, liveConnectionId).catch(() => ({ trades: [] as any[], total: 0 }))
          : Promise.resolve({ trades: [] as any[], total: 0 }),
        fetch(
          `/api/orders?limit=500${liveConnectionId ? `&connectionId=${encodeURIComponent(liveConnectionId)}` : ''}`
        ).then(r => r.ok ? r.json() : { orders: [] }).catch(() => ({ orders: [] })),
      ]);

      if (!mountedRef.current) return;

      // Persist user_baskets metadata (for grouping legs in Order History).
      // Also build lookup maps so we can stamp each order's basketName/emoji
      // from user_baskets (real broker orders don't carry it; demo orders do).
      const basketRows = (dbOrdersPayload?.baskets as any[]) || [];
      setBaskets(basketRows);
      const basketNameById = new Map<string, string>();
      const basketEmojiById = new Map<string, string>();
      for (const b of basketRows) {
        if (b?.id) {
          if (b.name) basketNameById.set(b.id, b.name);
          if (b.icon) basketEmojiById.set(b.id, b.icon);
        }
      }

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
        filledAt: trade.executedAt || trade.createdAt || null,
        source: 'manual',
      }));

      // Map public.orders entries to Order format
      const dbOrders: Order[] = ((dbOrdersPayload?.orders || []) as any[]).map((o: any): Order => ({
        id: o.id,
        symbol: o.symbol,
        side: (o.side === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
        type: (o.orderType || 'market') as 'market' | 'limit' | 'stop' | 'stop_limit',
        status: (o.status === 'submitted'
          ? 'submitted'
          : o.status === 'partially_filled'
            ? 'open'
            : (o.status || 'filled')) as Order['status'],
        qty: o.qty || 0,
        filledQty: o.filledQty || 0,
        filledPrice: o.filledPrice,
        totalValue: (o.filledQty || o.qty || 0) * (o.filledPrice || 0),
        timeInForce: (o.timeInForce || 'day') as 'day' | 'gtc' | 'ioc' | 'fok',
        createdAt: o.createdAt,
        updatedAt: o.createdAt,
        filledAt: o.filledAt ?? o.filled_at ?? null,
        cancelledAt: o.cancelledAt ?? o.cancelled_at ?? null,
        cancelReason: (o.cancelReason ?? (o as any).cancel_reason) ?? null,
        source: o.source ?? null,
        notional: (o.notional ?? (o as any).notional) ?? null,
        orderUnit: (o.orderUnit ?? (o as any).orderUnit) as 'dollars' | 'shares' | undefined,
        requestedAmount: (o.requestedAmount ?? (o as any).requestedAmount) ?? null,
        requestedQty: (o.requestedQty ?? (o as any).requestedQty) ?? null,
        brokerageOrderId: (o as any).brokerageOrderId,
        companyName: (o.companyName ?? (o as any).company_name) ?? null,
        basketId: o.basketId ?? null,
      }));

      const brokerOrders = [
        ...allOpenOrders,
        ...filledOrders,
      ];

      const mappedBrokerOrders = brokerOrders
        .map(mapToAppOrder);

      // Merge broker orders + trade_history + db orders, deduplicate by ID.
      // Priority: broker > trade_history > public.orders.
      // Also dedup DB orders whose brokerageOrderId matches a broker order's id
      // (same order reached the broker AND was persisted to our DB).
      //
      // ── Fix: "0 shares" on OPEN notional orders ───────────────────────
      // SnapTrade reports quantity=0 for open dollar (notional) orders and does
      // NOT report the requested dollar amount. Our persisted DB row HAS the
      // authoritative requested data (order_unit, requested_amount/qty, notional).
      // So before dedup drops the DB row, enrich each broker order with its
      // matching DB requested fields — broker stays authoritative for FILL data
      // (filledQty/filledPrice), DB supplies requested/notional context.
      const dbByBrokerId = new Map<string, Order>();
      for (const d of dbOrders) {
        if (d.brokerageOrderId) dbByBrokerId.set(d.brokerageOrderId.toLowerCase(), d);
      }

      const enrichedBrokerOrders = mappedBrokerOrders.map((o) => {
        const matchKey = (o.brokerageOrderId || o.id || '').toLowerCase();
        const dbMatch = dbByBrokerId.get(matchKey);
        if (!dbMatch) return o;
        return {
          ...o,
          notional: o.notional ?? dbMatch.notional,
          orderUnit: o.orderUnit ?? dbMatch.orderUnit,
          requestedAmount: o.requestedAmount ?? dbMatch.requestedAmount,
          requestedQty: o.requestedQty ?? dbMatch.requestedQty,
          source: o.source ?? dbMatch.source ?? null,
          filledAt: o.filledAt ?? dbMatch.filledAt ?? null,
          cancelledAt: o.cancelledAt ?? dbMatch.cancelledAt ?? null,
          // Fall back to DB requested qty when broker qty is 0/absent (open notional)
          qty: Number(o.qty || 0) > 0 ? o.qty : (dbMatch.requestedQty ?? dbMatch.qty ?? 0),
          // DB is authoritative for cancel_reason (broker orders don't carry it)
          cancelReason: o.cancelReason ?? dbMatch.cancelReason ?? null,
          // Basket linkage lives on our persisted DB row — broker orders don't
          // carry it, so propagate it through the dedup so basket legs stay grouped.
          basketId: o.basketId ?? dbMatch.basketId ?? null,
          // Persisted company name also lives on the DB row — broker orders
          // don't carry it, so propagate it through the dedup.
          companyName: o.companyName ?? dbMatch.companyName ?? null,
        };
      });

      // ── Secondary link (recovered rows with NULL brokerage_order_id) ──
      // Rows recovered from `positions` (e.g. the Critical Minerals basket) have
      // brokerage_order_id = NULL, so the primary broker-ID dedup misses them
      // and they double-render: once as a basket leg, once as the broker's
      // standalone fill. Match basket-linked DB rows to broker fills by
      // symbol+side+filledQty (rounded) so the basket linkage + company name
      // attach to the authoritative broker fill and the DB row is dropped.
      const fillKeyOf = (o: { symbol?: string | null; side?: string | null; filledQty?: number | null }) => {
        const sym = (o.symbol || '').trim().toUpperCase();
        const side = (o.side || '').trim().toLowerCase();
        const qty = Number(o.filledQty || 0);
        if (!sym || !side || !qty) return null;
        return `${sym}|${side}|${(Math.round(qty * 1e6) / 1e6).toFixed(6)}`;
      };

      const brokerByFillKey = new Map<string, Order>();
      for (const o of enrichedBrokerOrders) {
        const k = fillKeyOf(o);
        if (k && !brokerByFillKey.has(k)) brokerByFillKey.set(k, o);
      }

      // Basket-linked DB rows without a brokerage_order_id that match a broker
      // fill — these get folded into the broker order (dropped from unique set).
      const dbByFillKey = new Map<string, Order>();
      for (const d of dbOrders) {
        if (d.brokerageOrderId) continue; // primary dedup already handles these
        if (!d.basketId) continue; // only fold basket legs; leave true solo rows alone
        const k = fillKeyOf(d);
        if (k && brokerByFillKey.has(k) && !dbByFillKey.has(k)) dbByFillKey.set(k, d);
      }

      const finalBrokerOrders = enrichedBrokerOrders.map((o) => {
        const k = fillKeyOf(o);
        const dbMatch = k ? dbByFillKey.get(k) : undefined;
        if (!dbMatch) return o;
        return {
          ...o,
          basketId: o.basketId ?? dbMatch.basketId ?? null,
          companyName: o.companyName ?? dbMatch.companyName ?? null,
          notional: o.notional ?? dbMatch.notional,
          orderUnit: o.orderUnit ?? dbMatch.orderUnit,
          requestedAmount: o.requestedAmount ?? dbMatch.requestedAmount,
          requestedQty: o.requestedQty ?? dbMatch.requestedQty,
          source: o.source ?? dbMatch.source ?? null,
        };
      });

      const brokerOrderIds = new Set(finalBrokerOrders.map(o => o.id));
      const brokerOrderIdsLower = new Set([...brokerOrderIds].map(id => id.toLowerCase()));
      const uniqueTradeHistory = tradeHistoryOrders.filter(o => !brokerOrderIds.has(o.id));
      const existingIds = new Set([...brokerOrderIds, ...uniqueTradeHistory.map(o => o.id)]);
      const secondaryLinkedFillKeys = new Set(dbByFillKey.keys());
      const uniqueDbOrders = dbOrders.filter(o => {
        if (existingIds.has(o.id)) return false;
        // Also match by brokerageOrderId — broker order's id IS the brokerage_order_id
        const dbBrokerId = o.brokerageOrderId;
        if (dbBrokerId && brokerOrderIdsLower.has(dbBrokerId.toLowerCase())) return false;
        // Drop NULL-brokerage basket legs that were secondary-linked to a broker fill.
        if (!dbBrokerId) {
          const k = fillKeyOf(o);
          if (k && secondaryLinkedFillKeys.has(k)) return false;
        }
        return true;
      });

      const allOrders = [...finalBrokerOrders, ...uniqueTradeHistory, ...uniqueDbOrders];

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

      // Stamp basket name/emoji onto every order that carries a basketId so
      // basket cards (Invest tab + Order History) resolve the real basket name
      // from user_baskets instead of falling back to a leg's ticker symbol.
      const enrichedWithBasket = mergedOrders.map((o: Order) => {
        const bid = o.basketId;
        if (!bid) return o;
        const name = basketNameById.get(bid);
        const emoji = basketEmojiById.get(bid);
        if (!name && !emoji) return o;
        return {
          ...o,
          basketName: o.basketName || name,
          basketEmoji: o.basketEmoji || emoji,
        };
      });

      console.error('[useOrders] refresh DONE —', enrichedWithBasket.length, 'orders loaded (', mappedBrokerOrders.length, 'from broker +', uniqueTradeHistory.length, 'from trade_history +', uniqueDbOrders.length, 'from db +', orphanOrders.length, 'orphan), symbols:', enrichedWithBasket.map(o => o.symbol).join(', ') || '(none)');
      setOrders(enrichedWithBasket);
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
          liveConnectionId,
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
  }, [broker, isConnected, isShowingDemo, liveConnectionId, setOrders, user]);

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
    async (orderId: string): Promise<CancelOutcome> => {
      // Demo / local broker → use the local adapter (client-side localStorage).
      if (isShowingDemo || !isConnected || !broker) {
        if (broker) {
          await broker.cancelOrder(orderId);
          updateOrder(orderId, { status: 'cancelled' });
          return { cancelled: true };
        }
        throw new Error('Broker not connected');
      }

      // Real broker → server-side proxy. The client BrokerAdapter's
      // cancelOrder() is a read-only stub (throws READ_ONLY_ERROR); the only
      // working cancel path is /api/broker/cancel-order (SnapTrade credentials
      // stay server-side). Optimistic UI update; the 30s poll reconciles.
      const res = await fetch('/api/broker/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json().catch(() => ({}));

      // Cancel race: broker already filled (or otherwise terminal) the order.
      if (data.reconciled === true) {
        if (data.alreadyFilled === true) {
          const fillPrice =
            typeof data.fillPrice === 'number' ? data.fillPrice : undefined;
          const filledQty =
            typeof data.filledQty === 'number' ? data.filledQty : undefined;
          updateOrder(orderId, {
            status: 'filled',
            filledPrice: fillPrice,
            filledQty: filledQty,
            totalValue:
              fillPrice != null && filledQty != null
                ? fillPrice * filledQty
                : undefined,
            cancelReason: 'already_filled',
          });
          return { alreadyFilled: true, fillPrice, filledQty };
        }
        // Other terminal state (cancelled/rejected) — reflect the real status.
        const realStatus: Order['status'] =
          data.status === 'filled'
            ? 'filled'
            : data.status === 'cancelled'
              ? 'cancelled'
              : data.status === 'rejected'
                ? 'rejected'
                : 'open';
        updateOrder(orderId, {
          status: realStatus,
          cancelReason: realStatus === 'cancelled' ? 'external' : null,
        });
        return { alreadyTerminal: true, status: realStatus };
      }

      if (!res.ok || data.success === false) {
        throw new Error(data.error || data.message || 'Cancel failed');
      }
      updateOrder(orderId, { status: 'cancelled', cancelReason: 'user_cancelled' });
      return { cancelled: true };
    },
    [broker, isConnected, isShowingDemo, updateOrder]
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
          if (activeFilter === 'open') return isWorkingStatus(o.status);
          return o.status === activeFilter;
        });

  return {
    orders: filteredOrders,
    allOrders: orders,
    baskets,
    loading,
    error,
    refresh,
    placeOrder,
    cancelOrder,
    activeFilter,
  };
}
