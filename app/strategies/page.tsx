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

  const scheduleCount = (key: string) => key === 'dca' ? activeSchedules.length : 0;

  return (
    <div style={{ height: '100vh', overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#0f172a', color: '#f1f5f9', padding: '16px 16px 120px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => router.back()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '6px 0', marginBottom: 16, fontFamily: 'inherit' }}>
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', margin: '0 0 6px' }}>Strategy Manager</h1>
        <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Configure and monitor automated trading strategies</p>
      </div>

      {/* Active Schedules Summary */}
      {!loading && activeSchedules.length > 0 && (
        <div style={{ marginBottom: 24, padding: 14, background: '#1e293b', border: '1px solid #334155', borderRadius: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
            <Activity size={12} style={{ marginRight: 6 }} />Active Schedules
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeSchedules.map((s: any) => (
              <div key={s.id} onClick={() => router.push(`/strategies/setup/dca`)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{s.symbol}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#06b6d4', background: 'rgba(6,182,212,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                    DCA
                  </span>
                </div>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {s.config.investBy === 'shares' ? `${s.config.quantity || '?'} shares` : `$${s.config.amount}`} · {s.config.frequency}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategy Cards */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
        <TrendingUp size={12} style={{ marginRight: 6 }} />All Strategies
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {STRATEGIES.map(s => (
          <div
            key={s.key}
            onClick={() => s.available ? router.push(s.path) : null}
            style={{
              padding: '14px 16px',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 12,
              cursor: s.available ? 'pointer' : 'default',
              opacity: s.available ? 1 : 0.5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{s.name}</span>
                  {!s.available && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: '#64748b', background: '#0f172a', padding: '2px 6px', borderRadius: 4 }}>Soon</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.desc}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {scheduleCount(s.key) > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#06b6d4', background: 'rgba(6,182,212,0.12)', padding: '3px 8px', borderRadius: 9999 }}>
                    {scheduleCount(s.key)} active
                  </span>
                )}
                {s.available && <Plus size={16} style={{ color: '#64748b' }} />}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
