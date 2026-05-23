'use client';
import { usePortfolio } from '@/hooks/usePortfolio';
import { usePortfolioStore } from '@/store';

export function PortfolioTab() {
  const { account, loading, error, refresh } = usePortfolio();
  const store = usePortfolioStore();

  const fmt = (n: number) =>
    `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) =>
    `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  // Loading state — skeleton shimmer
  if (loading && !account) {
    return (
      <div style={{ padding: '12px 16px 80px' }}>
        <div className="card skeleton" style={{ height: 160, marginBottom: 12 }} />
        <div className="card skeleton" style={{ height: 100, marginBottom: 12 }} />
        <div className="card skeleton" style={{ height: 80, marginBottom: 12 }} />
        <SectorsSkeleton />
        <style jsx>{`
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
          .skeleton {
            background: linear-gradient(90deg, #1e293b 25%, #334155 50%, #1e293b 75%);
            background-size: 200% 100%;
            animation: shimmer 1.5s infinite;
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
  if (error && !account) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Unable to load portfolio
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

  // Empty state — no positions
  if (account && account.positions.length === 0) {
    return (
      <div style={{ padding: '12px 16px 80px' }}>
        {/* Account Summary — shown even without positions */}
        <div className="card" style={{ marginBottom: 12 }}>
          <AccountSummaryCard account={account} />
        </div>

        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>📈</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            No positions yet
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Ready to start investing? Your buying power is ${account.buyingPower.toLocaleString()}.
          </div>
          <button
            style={{
              padding: '8px 20px', background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
              border: 'none', borderRadius: 8, color: 'white', fontWeight: 600, fontSize: 12, cursor: 'pointer',
            }}
          >
            Explore Stocks
          </button>
        </div>
      </div>
    );
  }

  // Data state
  if (!account) {
    return (
      <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Connecting to broker...
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 80px' }}>
      {/* Market Closed Banner */}
      {/* (would be dynamic from useBrokerData — keeping it simple) */}

      {/* Error banner for partial failures */}
      {error && (
        <div style={{
          padding: '8px 12px', marginBottom: 10,
          background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 8, fontSize: 11, color: '#f87171',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠ {error}</span>
          <button onClick={refresh} style={{
            background: 'transparent', border: 'none', color: '#f87171',
            cursor: 'pointer', fontSize: 11, fontWeight: 600,
          }}>
            Retry
          </button>
        </div>
      )}

      {/* Account Summary */}
      <div className="card" style={{ marginBottom: 12 }}>
        <AccountSummaryCard account={account} />
      </div>

      {/* Performance Chart Placeholder */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Performance</span>
          <span style={{ fontSize: 10 }}>
            <span className={account.totalPnlPercent >= 0 ? 'up' : 'down'}>
              {pct(account.totalPnlPercent)}
            </span>
          </span>
        </div>
        <div className="chart-skeleton" style={{ height: 80, position: 'relative', overflow: 'hidden' }}>
          <svg width="100%" height="80" viewBox="0 0 300 80" preserveAspectRatio="none">
            <path
              d="M0,60 L30,55 L60,58 L90,50 L120,45 L150,38 L180,42 L210,30 L240,25 L270,28 L300,18"
              stroke={account.totalPnl >= 0 ? '#4ade80' : '#f87171'}
              strokeWidth="2"
              fill="none"
            />
          </svg>
        </div>
      </div>

      {/* Sector Allocation */}
      <SectorAllocation positions={account.positions} />

      {/* Positions */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>
            Positions ({account.positions.length})
          </span>
          <button className="sort-btn">Sort: % ▼</button>
        </div>

        {account.positions.map((pos) => (
          <div key={pos.symbol} className="pos-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{pos.symbol}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {pos.qty} shares {pos.sector && `· ${pos.sector}`}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>
                  ${pos.marketValue.toLocaleString()}
                </div>
                <div
                  className={pos.dayChange >= 0 ? 'up' : 'down'}
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {pos.dayChange >= 0 ? '+' : ''}${pos.dayChange.toLocaleString()} ({pct(pos.dayChangePercent)})
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 4,
                paddingTop: 6,
                borderTop: '1px solid #334155',
              }}
            >
              {([
                ['Avg Cost', `$${pos.avgCost}`],
                ['Current', `$${pos.currentPrice}`],
                ['Total P&L', `${pos.totalPnl >= 0 ? '+' : ''}$${pos.totalPnl.toLocaleString()}`],
                ['% Port', `${pos.portfolioPercent.toFixed(1)}%`],
              ] as [string, string][]).map(([label, val]) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div
                    style={{
                      fontSize: 8,
                      color: 'var(--text-dim)',
                      textTransform: 'uppercase',
                      marginBottom: 1,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: val.startsWith('+') ? '#4ade80' : val.startsWith('-') ? '#f87171' : '#f1f5f9',
                    }}
                  >
                    {val}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                height: 3,
                background: '#334155',
                borderRadius: 2,
                marginTop: 6,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pos.portfolioPercent}%`,
                  background: 'linear-gradient(90deg, #06b6d4, #0d9488)',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <style jsx>{`
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          padding: 12px;
        }
        .pos-row {
          padding: 10px;
          background: #0f172a;
          border-radius: 8px;
          margin-bottom: 8px;
          cursor: pointer;
        }
        .pos-row:active { background: #334155; }
        .sort-btn {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 6px;
          padding: 4px 8px;
          font-size: 10px;
          color: #94a3b8;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function AccountSummaryCard({ account }: { account: import('@/types').AccountSummary }) {
  const fmt = (n: number) => `$${Math.abs(n).toLocaleString()}`;
  const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  return (
    <>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        Account Value
      </div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>
        ${account.equity.toLocaleString()}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginTop: 8,
          paddingTop: 10,
          borderTop: '1px solid #334155',
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            Today P&L
          </div>
          <div
            className={account.dayPnl >= 0 ? 'up' : 'down'}
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {fmt(account.dayPnl)} ({pct(account.dayPnlPercent)})
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            Total P&L
          </div>
          <div
            className="up"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            {fmt(account.totalPnl)} ({pct(account.totalPnlPercent)})
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            Buying Power
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.buyingPower.toLocaleString()}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              marginBottom: 2,
            }}
          >
            Cash
          </div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            ${account.cash.toLocaleString()}
          </div>
        </div>
      </div>
    </>
  );
}

const SECTOR_COLORS = [
  '#06b6d4',
  '#8b5cf6',
  '#22c55e',
  '#f59e0b',
  '#ec4899',
  '#3b82f6',
  '#ef4444',
  '#64748b',
];

function SectorAllocation({ positions }: { positions: import('@/types').Position[] }) {
  const sectorTotals: Record<string, { value: number; color: string }> = {};
  for (const pos of positions) {
    const sector = pos.sector || 'Other';
    if (!sectorTotals[sector]) {
      sectorTotals[sector] = {
        value: 0,
        color: SECTOR_COLORS[Object.keys(sectorTotals).length % SECTOR_COLORS.length],
      };
    }
    sectorTotals[sector].value += pos.marketValue;
  }

  const totalValue = Object.values(sectorTotals).reduce((s, v) => s + v.value, 0);
  const allocations = Object.entries(sectorTotals)
    .map(([sector, { value, color }]) => ({
      sector,
      percent: totalValue > 0 ? Math.round((value / totalValue) * 100) : 0,
      color,
    }))
    .sort((a, b) => b.percent - a.percent);

  if (allocations.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
        Sector Allocation
      </div>
      <div
        style={{
          display: 'flex',
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          marginBottom: 10,
        }}
      >
        {allocations.map((a) => (
          <div
            key={a.sector}
            style={{ width: `${a.percent}%`, height: '100%', background: a.color }}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {allocations.map((a) => (
          <div
            key={a.sector}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: a.color,
              }}
            />
            <span style={{ color: '#cbd5e1', flex: 1 }}>{a.sector}</span>
            <span style={{ color: '#f1f5f9', fontWeight: 600 }}>
              {a.percent}%
            </span>
          </div>
        ))}
      </div>
      <style jsx>{`
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 12px; }
      `}</style>
    </div>
  );
}

function SectorsSkeleton() {
  return (
    <div className="card skeleton" style={{ height: 100 }} />
  );
}
