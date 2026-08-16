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

const FILTERS = ['open', 'filled', 'cancelled', 'all'] as const;

function formatOrderDate(date: string) {
  const d = new Date(date);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

// ─── Requested vs filled formatting helpers ──────────────────
// The four-field model: order_unit decides which "requested" field is
// authoritative. The other is a labeled DERIVED ESTIMATE, never a bare number.

function fmtShares(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '';
  return `${Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function fmtDollars(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '';
  return `$${Number(n).toFixed(2)}`;
}

function resolveRequested(order: Order) {
  const unit: 'dollars' | 'shares' =
    order.orderUnit ?? (order.notional != null && order.notional > 0 ? 'dollars' : 'shares');
  const requestedAmount = order.requestedAmount ?? (unit === 'dollars' ? order.notional : null);
  const requestedQty = order.requestedQty ?? (unit === 'shares' ? order.qty : (order.qty > 0 ? order.qty : null));
  return { unit, requestedAmount, requestedQty };
}

// ─── Order Timeline Stepper ────────────────────────────────

function formatStepTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function orderOrigin(order: Order): string {
  return order.source === 'ai_advisor' ? 'via AI Advisor' : 'Manual buy';
}

function orderRef(order: Order): string {
  const bare = (order.brokerageOrderId || order.id).replace(/^demo-/, '');
  return '#' + bare.slice(0, 8);
}

function OrderStepper({ order }: { order: Order }) {
  const s = order.status;
  const isFilled = s === 'filled';
  const isCancelled = s === 'cancelled';
  const isRejected = s === 'rejected';
  const isSubmitted = s === 'submitted';
  // 'open' and 'pending' both mean the order is confirmed working at the venue.
  const isOpen = s === 'open' || s === 'pending';

  const placedTime = formatStepTime(order.createdAt);

  // Middle step: Open (normal) → Cancelled/Rejected (diverged branch).
  let middleLabel = 'Open';
  let middleKind: 'done' | 'active' | 'cancelled' = 'active';
  let middleTime = '';
  if (isFilled) {
    middleKind = 'done';
    middleTime = formatStepTime(order.filledAt || order.updatedAt);
  } else if (isCancelled) {
    middleLabel = 'Cancelled';
    middleKind = 'cancelled';
    middleTime = formatStepTime(order.cancelledAt || order.updatedAt);
  } else if (isRejected) {
    middleLabel = 'Rejected';
    middleKind = 'cancelled';
    middleTime = formatStepTime(order.cancelledAt || order.updatedAt);
  } else if (isOpen) {
    middleKind = 'done';
    middleTime = formatStepTime(order.updatedAt || order.createdAt);
  } else {
    // submitted → still awaiting venue acknowledgement, keep "Open" as the active step.
    middleKind = 'active';
    middleTime = '';
  }

  // Filled step
  const filledTime = isFilled ? formatStepTime(order.filledAt) : '';
  const filledMuted = isCancelled || isRejected;
  const filledDot = isFilled ? '✓' : filledMuted ? '—' : '3';
  const filledDotClass = isFilled ? 'done' : '';

  // Connectors:
  //  Placed → middle: emerald once the order reached the middle step (open/filled/cancelled);
  //    red if REJECTED (diverged immediately after placement, never reached Open);
  //    faint while still SUBMITTED.
  const placedLineClass = isRejected ? 'cancelled' : isSubmitted ? '' : 'done';
  //  middle → Filled: emerald when filled; red when the branch terminated (cancelled/rejected);
  //    faint while still open/submitted.
  const middleLineClass = isFilled ? 'done' : isCancelled || isRejected ? 'cancelled' : '';

  return (
    <div className="stepper">
      <div className="step">
        <div className={`line ${placedLineClass}`} />
        <div className="dot done">✓</div>
        <div className="step-label done">Placed</div>
        <div className="step-time">{placedTime}</div>
      </div>
      <div className="step">
        <div className={`line ${middleLineClass}`} />
        <div className={`dot ${middleKind}`}>
          {middleKind === 'done' ? '✓' : middleKind === 'cancelled' ? '✕' : '●'}
        </div>
        <div className={`step-label ${middleKind}`}>{middleLabel}</div>
        <div className="step-time">{middleKind === 'active' ? (middleTime || 'pending') : middleTime}</div>
      </div>
      <div className="step" style={filledMuted ? { opacity: 0.35 } : undefined}>
        <div className={`dot ${filledDotClass}`}>{filledDot}</div>
        <div className={`step-label ${filledDotClass}`}>Filled</div>
        <div className="step-time">{filledTime}</div>
      </div>
    </div>
  );
}

function RequestedFilledBlocks({ order }: { order: Order }) {
  const r = resolveRequested(order);
  const openNow = order.status === 'open' || order.status === 'pending' || order.status === 'submitted';

  let reqValue: string;
  let reqEst: string | null = null;
  if (r.unit === 'dollars') {
    reqValue = r.requestedAmount != null && r.requestedAmount > 0 ? fmtDollars(r.requestedAmount) : '—';
    reqEst = r.requestedQty != null && r.requestedQty > 0 ? `≈${fmtShares(r.requestedQty)} shares est.` : null;
  } else {
    reqValue = r.requestedQty != null && r.requestedQty > 0 ? `${fmtShares(r.requestedQty)} shares` : '—';
    reqEst = r.requestedAmount != null && r.requestedAmount > 0 ? `≈${fmtDollars(r.requestedAmount)} est.` : null;
  }

  const fillQty = order.filledQty ?? order.qty;
  const fillPrice = order.filledPrice;
  const hasFill = fillQty != null && fillQty > 0 && fillPrice != null;
  const fillAmount = hasFill ? fillQty * fillPrice : null;

  return (
    <div className="data-row">
      <div className="data-block">
        <div className="k">Requested</div>
        <div className="v">{reqValue}</div>
        {reqEst && <div className="est-tag">{reqEst}</div>}
      </div>
      <div className={`data-block ${hasFill ? 'filled' : ''}`}>
        <div className="k">Filled</div>
        {hasFill ? (
          <>
            <div className="v">{fmtShares(fillQty)} sh @ {fmtDollars(fillPrice)}</div>
            <div className="est-tag" style={{ color: '#3ddc97' }}>{fmtDollars(fillAmount)} total</div>
          </>
        ) : (
          <div className="v muted">{openNow ? 'Awaiting broker' : 'Not filled'}</div>
        )}
      </div>
    </div>
  );
}

export function OrdersTab() {
  const router = useRouter();
  const { orders, allOrders, loading, error, refresh, cancelOrder } = useOrders();
  const { activeFilter, setFilter } = useOrderStore();
  const { setTab } = useTabStore();
  const { account } = usePortfolio();
  const { isConnected } = useBroker();
  const { user } = useAuth();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [cancelNotice, setCancelNotice] = useState<{ kind: 'filled' | 'error'; message: string } | null>(null);

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

  const isWorking = (status: string) =>
    status === 'open' || status === 'pending' || status === 'submitted';

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
      {orders.length === 0 && !loading && (
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

      {/* Orders List */}
      {orders.map((order) => {
        const working = isWorking(order.status);
        return (
        <div key={order.id} className={`order-card ${order.status}`}>
          {/* Card head: symbol + side + origin + ref */}
          <div className="card-head">
            <div className="head-left">
              <span className="sym">{order.symbol}</span>
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

          {/* Cancellation / rejection note */}
          {(order.status === 'cancelled' || order.status === 'rejected') && (
            <div className="cancel-note">
              {order.status === 'cancelled'
                ? "We could no longer confirm this order's status with your broker and marked it cancelled — verify directly with your broker if you're unsure."
                : "This order was rejected by your broker before it could be opened — verify directly with your broker if you're unsure."}
            </div>
          )}

          {/* Actions row */}
          <div className="actions">
            {working && (
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
      })}

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

        /* Stepper */
        .stepper { display: flex; align-items: flex-start; margin: 14px 0 16px; }
        .step { display: flex; flex-direction: column; align-items: center; flex: 1; position: relative; }
        .dot {
          width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 800; z-index: 2; border: 2px solid #5c6579; background: #0a0e16; color: #5c6579;
        }
        .dot.done { border-color: #3ddc97; background: #3ddc97; color: #06110c; }
        .dot.active { border-color: #f0b73f; background: #0a0e16; color: #f0b73f; animation: pulse 1.6s ease-in-out infinite; }
        .dot.cancelled { border-color: #ef7b6a; background: #ef7b6a; color: #1a0a08; }
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(240,183,63,0.4);} 50%{box-shadow:0 0 0 5px rgba(240,183,63,0);} }
        .line { position: absolute; top: 10px; left: 50%; width: 100%; height: 2px; background: #5c6579; z-index: 1; }
        .line.done { background: #3ddc97; }
        .line.cancelled { background: #ef7b6a; }
        .step:last-child .line { display: none; }
        .step-label { font-size: 9.5px; color: #5c6579; margin-top: 6px; text-align: center; letter-spacing: 0.02em; }
        .step-label.done { color: #3ddc97; }
        .step-label.active { color: #f0b73f; font-weight: 700; }
        .step-label.cancelled { color: #ef7b6a; }
        .step-time { font-size: 8.5px; color: #5c6579; margin-top: 1px; }

        /* Requested vs Filled */
        .data-row { display: flex; gap: 10px; }
        .data-block { flex: 1; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.1); border-radius: 11px; padding: 10px 12px; }
        .data-block .k { font-size: 9.5px; color: #5c6579; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; }
        .data-block .v { font-size: 14.5px; font-weight: 700; color: #eef2f7; }
        .data-block .v.muted { color: #8b96ab; font-weight: 600; font-size: 12.5px; font-style: italic; }
        .data-block.filled { border-color: rgba(61,220,151,0.3); background: rgba(61,220,151,0.04); }
        .data-block.filled .v { color: #3ddc97; }
        .est-tag { font-size: 9px; color: #5c6579; font-weight: 500; margin-top: 2px; }

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
      `}</style>

      </>
    </div>
  );
}

// ─── Inline detail row for expanded order cards ─────────────
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
      <span style={{ color: '#e2e8f0' }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
