'use client';
import { useRouter } from 'next/navigation';
import { useOrders } from '@/hooks/useOrders';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useOrderStore, useTabStore } from '@/store';
import { useBroker } from '@/components/providers/BrokerProvider';

import { BarChart3 } from 'lucide-react';
import { useState } from 'react';
import { AccountSummaryCard } from '@/components/shared/AccountSummaryCard';

const FILTERS = ['open', 'filled', 'cancelled', 'all'] as const;

export function OrdersTab() {
  const router = useRouter();
  const { orders, allOrders, loading, error, refresh, cancelOrder } = useOrders();
  const { activeFilter, setFilter } = useOrderStore();
  const { setTab } = useTabStore();
  const { account } = usePortfolio();
  const { isConnected } = useBroker();
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  // useOrders hook already pre-filters by activeFilter (open includes pending/partially_filled)

  const counts = {
    open: allOrders.filter(
      (o) => o.status === 'open' || o.status === 'pending'
    ).length,
    filled: allOrders.filter((o) => o.status === 'filled').length,
  };

  const statusStyle = (status: string) => {
    switch (status) {
      case 'open':
        return { background: 'rgba(251,191,36,0.2)', color: '#fbbf24' };
      case 'pending':
        return { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' };
      case 'filled':
        return { background: 'rgba(74,222,128,0.2)', color: '#4ade80' };
      case 'cancelled':
        return { background: 'rgba(100,116,139,0.2)', color: '#94a3b8' };
      case 'rejected':
        return { background: 'rgba(248,113,113,0.2)', color: '#f87171' };
      default:
        return { background: 'rgba(100,116,139,0.2)', color: '#94a3b8' };
    }
  };

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
      {!isConnected && (
        <div className="bg-amber-500/20 border border-amber-500/30 rounded-lg p-3 mb-4">
          <span className="text-amber-400 text-sm">📊 Showing demo order history</span>
        </div>
      )}
      {/* Account Summary */}
      {account && (
        <div style={{ marginBottom: 12 }}>
          <AccountSummaryCard account={account} />
        </div>
      )}

      {/* New Order */}
      <button
        onClick={() => setTab('trade')}
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
        className="plan-trades-btn"
      >
        <BarChart3 size={16} />
        Plan Trades with AI
      </button>

      {/* View all strategies */}
      <button
        onClick={() => router.push('/strategies')}
        style={{
          width: '100%',
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: '#64748b',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          marginBottom: 12,
          fontFamily: 'inherit',
        }}
      >
        View all strategies →
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

      {/* Empty state */}
      {orders.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          {activeFilter === 'open'
            ? 'No open orders — ready to place your first trade?'
            : `No ${activeFilter} orders`}
        </div>
      )}

      {/* Orders List */}
      {orders.map((order) => (
        <div key={order.id} className={`order-card ${order.status}`}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'start',
              marginBottom: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{order.symbol}</span>
              <span className={`side-badge ${order.side}`}>{order.side}</span>
            </div>
            <span className="status-badge" style={statusStyle(order.status)}>
              {order.status}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 6,
              marginBottom: 8,
              padding: 8,
              background: '#0f172a',
              borderRadius: 6,
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 8,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  marginBottom: 1,
                }}
              >
                Type
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{order.type}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 8,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  marginBottom: 1,
                }}
              >
                Qty
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>{order.qty}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 8,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  marginBottom: 1,
                }}
              >
                {order.type === 'market'
                  ? 'Fill'
                  : order.type === 'limit'
                  ? 'Price'
                  : 'Stop'}
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>
                $
                {(
                  order.filledPrice ??
                  order.limitPrice ??
                  order.stopPrice ??
                  0
                ).toFixed(2)}
              </div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  fontSize: 8,
                  color: '#64748b',
                  textTransform: 'uppercase',
                  marginBottom: 1,
                }}
              >
                TIF
              </div>
              <div style={{ fontSize: 11, fontWeight: 600 }}>
                {order.timeInForce.toUpperCase()}
              </div>
            </div>
          </div>

          {order.bracketOrder && (
            <div style={{ fontSize: 10, color: '#06b6d4', marginBottom: 6 }}>
              🛡️ Bracket: SL ${order.bracketOrder.stopLoss} / TP ${order.bracketOrder.takeProfit}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 10,
              color: '#64748b',
            }}
          >
            <span>
              {order.status === 'filled' ? 'Filled' : 'Placed'}:{' '}
              {new Date(order.createdAt).toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              {(order.status === 'open' || order.status === 'pending') && (
                <button
                  className="action-btn"
                  onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                >
                  Modify
                </button>
              )}
              {(order.status === 'open' || order.status === 'pending') && (
                <button
                  className="action-btn"
                  style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }}
                  onClick={() => cancelOrder(order.id)}
                >
                  Cancel
                </button>
              )}
              {order.status === 'filled' && (
                <button
                  className="action-btn"
                  onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                >
                  {expandedOrderId === order.id ? 'Hide' : 'Details'}
                </button>
              )}
              {(order.status === 'cancelled' || order.status === 'rejected') && (
                <button
                  className="action-btn"
                  onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                >
                  {expandedOrderId === order.id ? 'Hide' : 'Details'}
                </button>
              )}
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
              <DetailRow label="Qty Ordered" value={String(order.qty)} />
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
              <DetailRow label="Created" value={new Date(order.createdAt).toLocaleString()} />
              {order.updatedAt && order.updatedAt !== order.createdAt && (
                <DetailRow label="Updated" value={new Date(order.updatedAt).toLocaleString()} />
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
              {(order.status === 'open' || order.status === 'pending') && (
                <div style={{ marginTop: 4, fontSize: 10, color: '#64748b', textAlign: 'center', lineHeight: 1.4 }}>
                  Order modification coming soon — cancel and re-place to adjust.
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <style jsx>{`
        .plan-trades-btn {
          width: 100%;
          padding: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: rgba(6, 182, 212, 0.1);
          border: 1px dashed rgba(6, 182, 212, 0.3);
          border-radius: 8px;
          color: #06b6d4;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          margin-bottom: 12px;
          font-family: inherit;
          transition: background 0.2s;
        }
        .plan-trades-btn:active { background: rgba(6, 182, 212, 0.2); }
        .order-card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 10px;
          padding: 11px;
          margin-bottom: 8px;
        }
        .order-card.filled { border-left: 3px solid #4ade80; }
        .order-card.open { border-left: 3px solid #fbbf24; }
        .order-card.pending { border-left: 3px solid #fbbf24; }
        .order-card.cancelled { border-left: 3px solid #64748b; opacity: 0.7; }
        .order-card.rejected { border-left: 3px solid #f87171; opacity: 0.7; }
        .side-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .side-badge.buy { background: rgba(34,197,94,0.2); color: #4ade80; }
        .side-badge.sell { background: rgba(239,68,68,0.2); color: #f87171; }
        .status-badge {
          font-size: 9px;
          padding: 2px 7px;
          border-radius: 3px;
          font-weight: 600;
          text-transform: uppercase;
        }
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
    </div>
  );
}

// ─── Inline detail row for expanded order cards ─────────────
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
