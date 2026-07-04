'use client';

import { apiPost } from '@/lib/api-client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { getDemoAccount, getDemoSymbols } from '@/lib/demo-data';
import { Target, TrendingUp, DollarSign, X, Edit3, Save } from 'lucide-react';

// ─── localStorage keys ───────────────────────────────────────
const GOALS_KEY = 'vantage:goals';

interface GoalData {
  portfolioTarget: number;
  returnTarget: number; // annual %
}

function loadGoals(): GoalData {
  try {
    const raw = localStorage.getItem(GOALS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { portfolioTarget: 0, returnTarget: 0 };
}

function saveGoals(goals: GoalData) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(goals));
}

// ─── Inner Page ──────────────────────────────────────────────
function GoalsPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const { isConnected } = useBroker();
  const [goals, setGoals] = useState<GoalData>(loadGoals);
  const [editing, setEditing] = useState<'portfolio' | 'return' | null>(null);
  const [editValue, setEditValue] = useState('');
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    if (isConnected) return;
    // Calculate demo portfolio value from live prices
    const style = user?.investorStyle || 'buffett';
    const symbols = getDemoSymbols(style as any);
    apiPost('/api/market/quotes', { symbols })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => {
        const account = getDemoAccount(style as any, d.quotes);
        if (account) {
          setPortfolioValue(account.equity);
          setDemoMode(true);
        }
      })
      .catch(() => {});
  }, [isConnected, user?.investorStyle]);

  const startEdit = (field: 'portfolio' | 'return') => {
    setEditing(field);
    setEditValue(field === 'portfolio' ? String(goals.portfolioTarget || '') : String(goals.returnTarget || ''));
  };

  const saveEdit = () => {
    const val = parseFloat(editValue) || 0;
    const updated = { ...goals };
    if (editing === 'portfolio') updated.portfolioTarget = Math.max(0, val);
    else updated.returnTarget = Math.max(0, Math.min(100, val));
    setGoals(updated);
    saveGoals(updated);
    setEditing(null);
  };

  const pctToTarget = goals.portfolioTarget > 0
    ? Math.min(100, Math.round((portfolioValue / goals.portfolioTarget) * 100))
    : 0;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      padding: 16, paddingBottom: 32,
      background: '#0a0e27',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{
          background: '#0f172a', border: '1px solid #334155',
          borderRadius: 16, padding: '32px 24px',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(6,182,212,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Target size={18} style={{ color: '#06b6d4' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Goals & Targets</h1>
              {demoMode && (
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'linear-gradient(135deg, rgba(147,51,234,0.3), rgba(6,182,212,0.25))', color: '#c084fc', border: '1px solid rgba(147,51,234,0.3)' }}>DEMO</span>
              )}
            </div>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {demoMode && (
            <div style={{ fontSize: 11, color: '#c084fc', marginBottom: 16, padding: '8px 12px', background: 'rgba(147,51,234,0.08)', borderRadius: 8, border: '1px solid rgba(147,51,234,0.15)' }}>
              Demo mode — connect a broker to track real portfolio progress.
            </div>
          )}

          {/* Current Portfolio Value */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Current Portfolio Value</div>
            <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#e2e8f0' }}>
              ${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>

          {/* Portfolio Value Target */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <DollarSign size={14} style={{ color: '#22c55e' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Portfolio Value Target</span>
              </div>
              {editing === 'portfolio' ? (
                <button onClick={saveEdit} style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', padding: 4 }}>
                  <Save size={15} />
                </button>
              ) : (
                <button onClick={() => startEdit('portfolio')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                  <Edit3 size={14} />
                </button>
              )}
            </div>
            {editing === 'portfolio' ? (
              <input
                type="number"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                placeholder="Enter target amount (e.g. 500000)"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: 8 }}>
                  {goals.portfolioTarget > 0 ? `$${goals.portfolioTarget.toLocaleString()}` : 'Not set'}
                </div>
                {goals.portfolioTarget > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#cbd5e1', marginBottom: 4 }}>
                      <span>{pctToTarget}% to target</span>
                      <span>${(goals.portfolioTarget - portfolioValue).toLocaleString()} remaining</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: '#1e293b', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #06b6d4, #22c55e)', width: `${pctToTarget}%`, transition: 'width 0.5s' }} />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Return Target */}
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={14} style={{ color: '#f59e0b' }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>Annual Return Target</span>
              </div>
              {editing === 'return' ? (
                <button onClick={saveEdit} style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', padding: 4 }}>
                  <Save size={15} />
                </button>
              ) : (
                <button onClick={() => startEdit('return')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}>
                  <Edit3 size={14} />
                </button>
              )}
            </div>
            {editing === 'return' ? (
              <input
                type="number"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                placeholder="Enter target return % (e.g. 10)"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && saveEdit()}
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            ) : (
              <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {goals.returnTarget > 0 ? `${goals.returnTarget}% / year` : 'Not set'}
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 16 }}>
            Goals are saved locally on this device.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GoalsPage() {
  return (
    <BrokerProvider>
      <GoalsPageInner />
    </BrokerProvider>
  );
}
