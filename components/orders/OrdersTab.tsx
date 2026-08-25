'use client';
import { useRouter } from 'next/navigation';
import { useOrders } from '@/hooks/useOrders';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useOrderStore, useTabStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';

import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';
import DemoBanner from '@/components/shared/DemoBanner';
import type { Order } from '@/types';

import {
  formatOrderDate,
  resolveRequested,
  orderOrigin,
  orderRef,
  cancelReasonText,
  OrderStepper,
  RequestedFilledBlocks,
  DetailRow,
} from './OrderDisplay';
import { fmtShares, fmtDollars } from '@/lib/order-format';
import { isWorkingStatus } from '@/lib/order-format';

const FILTERS = ['open', 'filled', 'cancelled', 'all'] as const;

type DerivedBasketStatus = 'Open' | 'Filled' | 'Partial' | 'Cancelled';

interface BasketGroup {
  basketId: string;
  name: string;
  icon: string;
  theme: string | null;
  status: DerivedBasketStatus;
  placedAt: string;
  total: number;
  count: number;
  legs: Order[];
}

export function OrdersTab() {
  const router = useRouter();
  const { orders, allOrders, baskets, loading, error, refresh, cancelOrder } = useOrders();
  const { activeFilter, setFilter } = useOrderStore();
  const { setTab } = useTabStore();
  const { account } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [expandedBasketId, setExpandedBasketId] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<{ kind: 'filled' | 'error'; message: string } | null>(null);
  const [cancelBasketTarget, setCancelBasketTarget] = useState<BasketGroup | null>(null);

  const handleCancel = async (order: Order) => {
    setCancelNotice(null);
    try {
      const outcome = await cancelOrder(order.id);
      if ('alreadyFilled' in outcome && outcome.alreadyFilled) {
        setCancelNotice({
          kind: 'filled',
          message: `${order.symbol} had already filled before the cancel could be processed — showing the real result.`,
        });
      } else if ('alreadyTerminal' in outcome) {
        setCancelNotice({
          kind: 'filled',
          message: `${order.symbol} was already ${outcome.status} — showing the real result.`,
        });
      }
    } catch (err) {
      setCancelNotice({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Cancel failed',
      });
    }
    // Auto-dismiss after 8s
    setTimeout(() => setCancelNotice(null), 8000);
  };

  // useOrders hook already pre-filters by activeFilter (open includes pending/partially_filled)

  const counts = {
    open: allOrders.filter(
      (o) => o.status === 'open' || o.status === 'pending' || o.status === 'submitted'
    ).length,
    filled: allOrders.filter((o) => o.status === 'filled').length,
  };

  const isWorking = (status: string) => isWorkingStatus(status);

  // ── Basket grouping ───────────────────────────────────────────
  // Group orders that carry a basketId (real orders link to user_baskets via
  // orders.basket_id; demo orders carry their client-side basketId) into a
  // single accordion card per the Order History spec.
  const basketMeta = new Map<string, any>((baskets || []).map((b: any) => [b.id, b]));

  const groupByBasket = new Map<string, Order[]>();
  for (const o of allOrders) {
    const bid = (o as any).basketId as string | null | undefined;
    if (!bid) continue;
    if (!groupByBasket.has(bid)) groupByBasket.set(bid, []);
    groupByBasket.get(bid)!.push(o);
  }

  const basketGroups: BasketGroup[] = Array.from(groupByBasket.entries()).map(
    ([basketId, legs]) => {
      const meta = basketMeta.get(basketId);
      const workingLegs = legs.filter((l) => isWorking(l.status));
      const filledLegs = legs.filter((l) => l.status === 'filled');
      const terminalLegs = legs.filter(
        (l) => l.status === 'filled' || l.status === 'cancelled' || l.status === 'rejected'
      );
      let status: DerivedBasketStatus;
      if (workingLegs.length > 0 && filledLegs.length > 0) status = 'Partial';
      else if (workingLegs.length > 0) status = 'Open';
      else if (filledLegs.length > 0 && terminalLegs.length > filledLegs.length) status = 'Partial';
      else if (filledLegs.length === legs.length) status = 'Filled';
      else status = 'Cancelled';

      const name =
        meta?.name ||
        legs.find((l) => (l as any).basketName)?.basketName ||
        'Basket';
      const icon =
        meta?.icon ||
        legs.find((l) => (l as any).basketEmoji)?.basketEmoji ||
        '🧺';
      const theme = (meta?.theme_label as string | null) ?? null;
      const placedAt = legs.reduce(
        (min, l) => (new Date(l.createdAt) < new Date(min) ? l.createdAt : min),
        legs[0].createdAt
      );
      const total = legs.reduce((s, l) => s + (l.notional ?? l.totalValue ?? 0), 0);
      return { basketId, name, icon, theme, status, placedAt, total, count: legs.length, legs };
    }
  );

  const matchesFilter = (g: BasketGroup) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'open') return g.status === 'Open' || g.status === 'Partial';
    if (activeFilter === 'filled') return g.status === 'Filled';
    if (activeFilter === 'cancelled') return g.status === 'Cancelled';
    return true;
  };
  const visibleBasketGroups = basketGroups.filter(matchesFilter);
  const basketLegIds = new Set(basketGroups.flatMap((g) => g.legs.map((l) => l.id)));
  const soloOrders = orders.filter((o) => !basketLegIds.has(o.id));

  // ── Cancel entire basket (one action → cancel every open leg) ──
  const handleCancelBasket = async (group: BasketGroup) => {
    setCancelNotice(null);
    setCancelBasketTarget(null);
    const workingLegs = group.legs.filter((l) => isWorking(l.status));
    for (const leg of workingLegs) {
      try {
        await cancelOrder(leg.id);
      } catch (err) {
        setCancelNotice({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Cancel failed',
        });
      }
    }
    setTimeout(() => setCancelNotice(null), 8000);
  };

  // ── Order card renderer (shared by solo orders + basket legs) ──
  const renderOrderCard = (order: Order, inBasket = false) => {
    const working = isWorking(order.status);
    return (
      <div key={order.id} className={`order-card ${order.status}`}>
        {/* Card head: symbol + side + origin + ref */}
        <div className="card-head">
          <div className="head-left">
            <span className="sym">{order.symbol}</span>
            {order.companyName ? <span className="name">{order.companyName}</span> : null}
            <span className={`side-badge ${order.side}`}>{order.side.toUpperCase()}</span>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="origin">{orderOrigin(order)}</div>
            <div className="ref">{orderRef(order)}</div>
          </div>
        </div>

        {/* Timeline stepper: Placed → Open → Filled (or Cancelled/Rejected branch) */}
        <OrderStepper order={order} />

        {/* Requested vs Filled — always side by side */}
        <RequestedFilledBlocks order={order} />

        {/* Cancellation / rejection note — reason-specific via shared helper */}
        {(order.status === 'cancelled' || order.status === 'rejected') && (
          <div className="cancel-note">
            {cancelReasonText(order)}
          </div>
        )}

        {/* Actions row */}
        <div className="actions">
          {working && !inBasket && (
            <button className="cancel-btn" onClick={() => handleCancel(order)}>
              Cancel Order
            </button>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            {order.bracketOrder && (
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                {`🛡️ SL $${order.bracketOrder.stopLoss} / TP $${order.bracketOrder.takeProfit}`}
              </span>
            )}
            <button
              className="action-btn"
              onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
            >
              {expandedOrderId === order.id ? 'Hide' : 'Details'}
            </button>
          </div>
        </div>

        {/* Expanded Details Panel */}
        {expandedOrderId === order.id && (
          <div style={{
            marginTop: 10, padding: 12,
            background: '#0f172a', borderRadius: 8,
            border: '1px solid #1e293b',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <DetailRow label="Order ID" value={order.id.startsWith('demo-') ? order.id.replace('demo-', '').split('-').slice(0, -2).join('-') + '...' : order.id.slice(0, 12) + '...'} />
            <DetailRow label="Status" value={order.status.toUpperCase()} />
            <DetailRow label="Side" value={order.side.toUpperCase()} />
            <DetailRow label="Type" value={order.type.toUpperCase()} />
            {(() => {
              const r = resolveRequested(order);
              if (r.unit === 'dollars') {
                const amt = r.requestedAmount != null && r.requestedAmount > 0 ? fmtDollars(r.requestedAmount) : '—';
                const est = r.requestedQty != null && r.requestedQty > 0 ? `≈${fmtShares(r.requestedQty)} shares` : null;
                return (
                  <>
                    <DetailRow label="Requested Amount" value={amt} />
                    {est && <DetailRow label="Est. Shares" value={est} />}
                  </>
                );
              }
              const qtyStr = r.requestedQty != null && r.requestedQty > 0 ? `${fmtShares(r.requestedQty)} shares` : '—';
              const est = r.requestedAmount != null && r.requestedAmount > 0 ? `≈${fmtDollars(r.requestedAmount)}` : null;
              return (
                <>
                  <DetailRow label="Requested Qty" value={qtyStr} />
                  {est && <DetailRow label="Est. Amount" value={est} />}
                </>
              );
            })()}
            {order.filledQty !== undefined && order.filledQty !== order.qty && (
              <DetailRow label="Qty Filled" value={String(order.filledQty)} />
            )}
            {order.limitPrice !== undefined && (
              <DetailRow label="Limit Price" value={`$${order.limitPrice.toFixed(2)}`} />
            )}
            {order.stopPrice !== undefined && (
              <DetailRow label="Stop Price" value={`$${order.stopPrice.toFixed(2)}`} />
            )}
            {order.filledPrice !== undefined && (
              <DetailRow label="Filled Price" value={`$${order.filledPrice.toFixed(2)}`} />
            )}
            {order.totalValue !== undefined && (
              <DetailRow label="Total Value" value={`$${order.totalValue.toFixed(2)}`} />
            )}
            <DetailRow label="TIF" value={order.timeInForce.toUpperCase()} />
            <DetailRow label="Created" value={formatOrderDate(order.createdAt)} />
            {order.updatedAt && order.updatedAt !== order.createdAt && (
              <DetailRow label="Updated" value={formatOrderDate(order.updatedAt)} />
            )}
            {order.bracketOrder && (
              <>
                {order.bracketOrder.takeProfit && (
                  <DetailRow label="Take Profit" value={`$${order.bracketOrder.takeProfit.toFixed(2)}`} />
                )}
                {order.bracketOrder.stopLoss && (
                  <DetailRow label="Stop Loss" value={`$${order.bracketOrder.stopLoss.toFixed(2)}`} />
                )}
              </>
            )}
            {working && (
              <div style={{ marginTop: 4, fontSize: 10, color: '#cbd5e1', textAlign: 'center', lineHeight: 1.4 }}>
                Order modification coming soon — cancel and re-place to adjust.
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Basket accordion card ──
  const renderBasketCard = (group: BasketGroup) => {
    const isOpen = expandedBasketId === group.basketId;
    const openCount = group.legs.filter((l) => isWorking(l.status)).length;
    const statusColor =
      group.status === 'Filled' ? '#4ade80'
      : group.status === 'Cancelled' ? '#64748b'
      : group.status === 'Partial' ? '#38bdf8'
      : '#fbbf24';
    return (
      <div key={`basket-${group.basketId}`} className="basket-card">
        <div
          className="basket-head"
          onClick={() => setExpandedBasketId(isOpen ? null : group.basketId)}
        >
          <div className="basket-head-left">
            <span className="basket-icon">{group.icon}</span>
            <div>
              <div className="basket-name">{group.name}</div>
              <div className="basket-summary">
                {formatOrderDate(group.placedAt)} · {fmtDollars(group.total)} · {group.count} {group.count === 1 ? 'stock' : 'stocks'}
              </div>
            </div>
          </div>
          <div className="basket-head-right">
            <span className="basket-status" style={{ color: statusColor, borderColor: statusColor }}>
              {group.status}
            </span>
            <span className="basket-chevron">{isOpen ? '▲' : '▼'}</span>
          </div>
        </div>

        {isOpen && (
          <div className="basket-legs">
            {group.legs.map((leg) => renderOrderCard(leg, true))}
            {group.status === 'Open' && (
              <button className="cancel-btn" onClick={() => setCancelBasketTarget(group)}>
                Cancel Entire Basket{openCount > 1 ? ` (${openCount} open)` : ''}
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Combined timeline (baskets + solo orders, newest first) ──
  const timeline: Array<
    | { key: string; ts: number; kind: 'basket'; group: BasketGroup }
    | { key: string; ts: number; kind: 'solo'; order: Order }
  > = [
    ...visibleBasketGroups.map((g) => ({
      key: `basket-${g.basketId}`,
      ts: new Date(g.placedAt).getTime(),
      kind: 'basket' as const,
      group: g,
    })),
    ...soloOrders.map((o) => ({
      key: o.id,
      ts: new Date(o.createdAt).getTime(),
      kind: 'solo' as const,
      order: o,
    })),
  ].sort((a, b) => b.ts - a.ts);

  // Loading state — skeleton shimmer
  if (loading && allOrders.length === 0) {
    return (
      <div style={{ padding: '12px 16px 80px' }}>
        <div className="skeleton-block" style={{ height: 44, marginBottom: 12 }} />
        <div className="skeleton-block" style={{ height: 36, marginBottom: 12 }} />
        {[1, 2, 3].map((i) => (
          <div key={i} className="skeleton-block" style={{ height: 120, marginBottom: 8 }} />
        ))}
        <style jsx>{`
          .skeleton-block {
            background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
            border-radius: 10px;
          }
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  }

  // Error state
  if (error && allOrders.length === 0) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Unable to load orders
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          {error}
        </div>
        <button
          onClick={refresh}
          style={{
            padding: '8px 20px', background: 'var(--accent-cyan)', border: 'none',
            borderRadius: 8, color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {/* Demo Mode Banner */}
      {!isConnected && <DemoBanner />}
      {/* Account Summary */}
      {account && (
        <div style={{ marginBottom: 12 }}>
          <AccountSummaryCard account={account} />
        </div>
      )}

      {/* ── holdingsUnavailable notice (info only — does not block orders) ── */}
      {/* Orders are fetched independently from holdings; a broker not sharing position
          data may still have accessible order history. */}
      {account?.holdingsUnavailable && (
        <div style={{
          textAlign: 'center', padding: '10px 20px',
          border: '1px dashed rgba(245,158,11,0.25)',
          borderRadius: 10, margin: '0 4px 12px',
          background: 'rgba(245,158,11,0.04)',
        }}>
          <div style={{ fontSize: 11, color: '#f59e0b' }}>
            ⚠️ Holdings data is not shared by this connection. Orders may still be available below.
          </div>
        </div>
      )}

      {/* ── Orders content ── */}
      <>

      {/* New Order */}
      <button
        onClick={() => setTab('invest')}
        style={{
          width: '100%',
          padding: 10,
          background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
          border: 'none',
          borderRadius: 8,
          color: 'white',
          fontWeight: 700,
          fontSize: 12,
          marginBottom: 8,
          cursor: 'pointer',
        }}
      >
        + Place New Order
      </button>

      {/* Plan Trades */}
      <button
        onClick={() => setTab('ai')}
        className="w-full flex items-center justify-center gap-2 border border-slate-600 bg-slate-800/50 text-cyan-400 text-sm font-medium rounded-2xl py-3.5 hover:bg-slate-700/50 transition"
      >
        <BarChart3 size={16} />
        Plan Trades with AI
      </button>

      {/* Filters */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginBottom: 12,
          background: '#1e293b',
          padding: 4,
          borderRadius: 8,
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: '7px',
              textAlign: 'center' as const,
              fontSize: 11,
              color: activeFilter === f ? 'white' : '#94a3b8',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              background: activeFilter === f ? '#06b6d4' : 'transparent',
              border: 'none',
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f in counts && (
              <span style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>
                ({counts[f as keyof typeof counts]})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Error banner (partial failure) */}
      {error && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
            background: 'rgba(248,113,113,0.1)',
            border: '1px solid rgba(248,113,113,0.3)',
            borderRadius: 8,
            fontSize: 11,
            color: '#f87171',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>⚠ {error}</span>
          <button
            onClick={refresh}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f87171',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty state — distinct for different scenarios */}
      {soloOrders.length === 0 && visibleBasketGroups.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {error ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📡</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#f87171', marginBottom: 4 }}>
                Order History Unavailable
              </div>
              <div style={{ fontSize: 11, marginBottom: 12 }}>
                Could not reach your broker to load orders. Check your connection and try again.
              </div>
            </>
          ) : activeFilter !== 'all' ? (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                No {activeFilter} orders
              </div>
              <div style={{ fontSize: 11 }}>
                {activeFilter === 'open'
                  ? 'No pending orders — ready to place your first trade?'
                  : activeFilter === 'filled'
                  ? 'No filled orders yet — your completed trades will appear here'
                  : `No ${activeFilter} orders found`}
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📭</div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                No Orders Yet
              </div>
              <div style={{ fontSize: 11 }}>
                Your order history will appear here once you start trading
              </div>
            </>
          )}
        </div>
      )}

      {/* Cancel-race notice (already filled / terminal) */}
      {cancelNotice && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
            background: cancelNotice.kind === 'filled'
              ? 'rgba(74,222,128,0.1)'
              : 'rgba(248,113,113,0.1)',
            border: `1px solid ${cancelNotice.kind === 'filled' ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)'}`,
            borderRadius: 8,
            fontSize: 11,
            color: cancelNotice.kind === 'filled' ? '#4ade80' : '#f87171',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{cancelNotice.kind === 'filled' ? '✅ ' : '⚠️ '}{cancelNotice.message}</span>
          <button
            onClick={() => setCancelNotice(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 12 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Orders List — basket groups (accordion) + standalone orders, newest first */}
      {timeline.map((item) =>
        item.kind === 'basket' ? renderBasketCard(item.group) : renderOrderCard(item.order)
      )}

      <style jsx>{`
        .order-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          padding: 14px 16px;
          margin-bottom: 8px;
        }
        .order-card.filled { border-left: 3px solid #4ade80; }
        .order-card.open { border-left: 3px solid #fbbf24; }
        .order-card.pending { border-left: 3px solid #fbbf24; }
        .order-card.submitted { border-left: 3px solid #fbbf24; }
        .order-card.cancelled { border-left: 3px solid #64748b; opacity: 0.7; }
        .order-card.rejected { border-left: 3px solid #f87171; opacity: 0.7; }

        /* Card head */
        .card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
        .head-left { display: flex; align-items: center; gap: 10px; }
        .sym { font-size: 17px; font-weight: 800; color: #fff; }
        .name { font-size: 10px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
        .origin { font-size: 10.5px; color: #8b96ab; border: 1px solid rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 20px; white-space: nowrap; }
        .ref { font-size: 10px; color: #5c6579; font-family: "SF Mono", Menlo, monospace; margin-top: 2px; }

        .side-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .side-badge.buy { background: rgba(34,197,94,0.2); color: #4ade80; }
        .side-badge.sell { background: rgba(239,68,68,0.2); color: #f87171; }

        .cancel-note {
          margin-top: 12px; padding: 10px 12px; border-radius: 10px;
          background: rgba(239,123,106,0.06); border: 1px dashed rgba(239,123,106,0.3);
          font-size: 11.5px; color: #ef7b6a; line-height: 1.5;
        }

        .actions { margin-top: 12px; }
        .cancel-btn { width: 100%; padding: 9px; border-radius: 10px; border: 1px solid rgba(239,123,106,0.4); background: transparent; color: #ef7b6a; font-size: 12.5px; font-weight: 700; cursor: pointer; font-family: inherit; margin-bottom: 6px; }
        .cancel-btn:active { opacity: 0.7; }

        .action-btn {
          padding: 4px 8px;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 4px;
          color: #cbd5e1;
          font-size: 10px;
          cursor: pointer;
          font-weight: 600;
          font-family: inherit;
        }
        .action-btn:active { opacity: 0.7; }

        /* Basket accordion card */
        .basket-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 16px;
          margin-bottom: 8px;
          overflow: hidden;
        }
        .basket-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 14px;
          cursor: pointer;
          user-select: none;
        }
        .basket-head:active { background: rgba(255,255,255,0.02); }
        .basket-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .basket-icon { font-size: 22px; line-height: 1; }
        .basket-name {
          font-size: 14px;
          font-weight: 800;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .basket-summary { font-size: 11px; color: #8b96ab; margin-top: 2px; }
        .basket-head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
        .basket-status {
          font-size: 9px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 20px;
          border: 1px solid;
          text-transform: uppercase;
          letter-spacing: 0.3px;
        }
        .basket-chevron { font-size: 11px; color: #64748b; }
        .basket-legs {
          padding: 0 12px 12px;
          border-top: 1px solid #263142;
          padding-top: 10px;
        }
      `}</style>

      {/* Cancel entire basket confirmation modal */}
      {cancelBasketTarget && (() => {
        const t = cancelBasketTarget;
        const filledCount = t.legs.filter((l) => l.status === 'filled').length;
        const pendingLegs = t.legs.filter((l) => isWorking(l.status));
        const pendingCount = pendingLegs.length;
        const reservedCash = pendingLegs.reduce((s, l) => s + (l.notional ?? l.totalValue ?? 0), 0);
        return (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={() => setCancelBasketTarget(null)}
          >
            <div
              style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 16, padding: 20, maxWidth: 360, width: '100%' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 24 }}>{t.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Cancel entire basket?</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1, background: '#0f172a', border: '1px solid #263142', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Filled</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#4ade80' }}>{filledCount}</div>
                </div>
                <div style={{ flex: 1, background: '#0f172a', border: '1px solid #263142', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>Pending</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fbbf24' }}>{pendingCount}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0f172a', border: '1px solid #263142', borderRadius: 10, marginBottom: 16 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Reserved cash</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{fmtDollars(reservedCash)}</span>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setCancelBasketTarget(null)}
                  style={{ flex: 1, padding: 10, borderRadius: 10, background: 'transparent', border: '1px solid #334155', color: '#cbd5e1', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Keep
                </button>
                <button
                  onClick={() => handleCancelBasket(t)}
                  style={{ flex: 1, padding: 10, borderRadius: 10, background: '#ef4444', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                >
                  Cancel {pendingCount} {pendingCount === 1 ? 'Order' : 'Orders'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      </>
    </div>
  );
}
