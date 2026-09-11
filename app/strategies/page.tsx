'use client';

import { apiGet } from '@/lib/api-client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Plus, TrendingUp, Activity } from 'lucide-react';

const STRATEGIES = [
  { key: 'dca', name: 'Dollar Cost Averaging', icon: '🔄', desc: 'Invest a fixed amount on a recurring schedule', path: '/strategies/setup/dca', available: true },
  { key: 'rebalancing', name: 'Portfolio Rebalancing', icon: '⚖️', desc: 'Restore target allocations when drift exceeds threshold', path: '/strategies/setup/rebalancing', available: true },
  { key: 'momentum', name: 'Momentum Rotation', icon: '🚀', desc: 'Rotate into top-performing assets based on momentum scores', path: '/strategies/setup/momentum', available: false },
  { key: 'meanreversion', name: 'Mean Reversion', icon: '📉', desc: 'Buy oversold, sell overbought based on z-scores', path: '/strategies/setup/meanreversion', available: false },
  { key: 'taxharvest', name: 'Tax Loss Harvesting', icon: '🧾', desc: 'Harvest losses to offset capital gains', path: '/strategies/setup/tax-harvesting', available: true },
];

export default function StrategiesPage() {
  const router = useRouter();
  const [activeSchedules, setActiveSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isReadOnly, setIsReadOnly] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await await apiGet('/api/strategies/dca/get-all');
        if (res.ok) {
          const data = await res.json();
          setActiveSchedules(data.schedules || []);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  // Hide DCA entirely on read-only (view-only) broker connections.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet('/api/broker/status');
        if (res.ok) {
          const s = await res.json();
          const connected = s.connected || s.isConnected || false;
          setIsReadOnly(connected && s.trading_enabled === false);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const scheduleCount = (key: string) => key === 'dca' ? activeSchedules.length : 0;

  return (
    <div className="strategy-page" style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: 'var(--v-canvas)', color: 'var(--v-text-primary)', padding: '16px 16px 120px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--v-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', marginBottom: 16, fontFamily: 'inherit' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--v-text-primary)', margin: '0 0 6px' }}>Strategy Manager</h1>
        <p style={{ fontSize: 13, color: 'var(--v-text-muted)', margin: 0 }}>Configure and monitor automated trading strategies</p>
      </div>

      {/* Active Schedules Summary */}
      {!loading && activeSchedules.length > 0 && (
        <div style={{ marginBottom: 24, padding: 14, background: 'var(--v-card)', border: '1px solid var(--v-card-border)', borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            <Activity size={12} style={{ marginRight: 6 }} />Active Schedules
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeSchedules.map((s: any) => (
              <div key={s.id} onClick={() => router.push(`/strategies/setup/dca`)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--v-canvas)', border: '1px solid var(--v-card-border)', borderRadius: 8, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-text-primary)' }}>{s.symbol}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--v-accent)', background: 'var(--v-accent-dim)', padding: '2px 8px', borderRadius: 4 }}>
                    DCA
                  </span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>
                  {s.config.investBy === 'shares' ? `${s.config.quantity || '?'} shares` : `$${s.config.amount}`} · {s.config.frequency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategy Cards */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
        <TrendingUp size={12} style={{ marginRight: 6 }} />All Strategies
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STRATEGIES.filter(s => !(isReadOnly && s.key === 'dca')).map(s => (
          <div
            key={s.key}
            onClick={() => s.available ? router.push(s.path) : null}
            style={{
              padding: '14px 16px',
              background: 'var(--v-card)',
              border: '1px solid var(--v-card-border)',
              borderRadius: 12,
              cursor: s.available ? 'pointer' : 'default',
              opacity: s.available ? 1 : 0.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-text-primary)' }}>{s.name}</span>
                  {!s.available && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--v-text-secondary)', background: 'var(--v-canvas)', padding: '2px 6px', borderRadius: 4 }}>Soon</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>{s.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {scheduleCount(s.key) > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--v-accent)', background: 'var(--v-accent-dim)', padding: '3px 8px', borderRadius: 9999 }}>
                    {scheduleCount(s.key)} active
                  </span>
                )}
                {s.available && <Plus size={16} style={{ color: 'var(--v-text-secondary)' }} />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
