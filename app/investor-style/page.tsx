'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { usePortfolio } from '@/hooks/usePortfolio';
import { getUserProfile, updateInvestorStyle } from '@/lib/supabase/user';
import { INVESTOR_STYLES } from '@/components/onboarding/styles';
import { detectConflict } from '@/lib/advisor/conflict-detection';
import type { InvestorStyle } from '@/types';
import type { StyleDef } from '@/components/onboarding/styles';
import type { Position, User } from '@/types';
import {
  ArrowLeft, RefreshCcw, Shield, AlertTriangle, Info,
  TrendingUp, CheckCircle, XCircle,
} from 'lucide-react';

// ─── Page ─────────────────────────────────────────────────────
export default function InvestorStylePage() {
  const { user, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const { account } = usePortfolio();
  const [profile, setProfile] = useState<User | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState(false);

  const currentStyle = profile?.investorStyle || 'buffett';
  const active = INVESTOR_STYLES.find(s => s.id === currentStyle)!;

  // ─── Load profile ──────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setLoadingProfile(true);
    getUserProfile(user.id)
      .then(p => {
        setProfile(p);
        setLoadingProfile(false);
      })
      .catch(() => {
        setError('Failed to load profile');
        setLoadingProfile(false);
      });
  }, [user]);

  // ─── Conflict detection ────────────────────────────────────
  const positions = account?.positions || [];

  const conflict = useMemo(() => {
    if (positions.length === 0) return null;
    // Build minimal stock data map from position data
    const stockData: Record<string, any> = {};
    for (const pos of positions) {
      stockData[pos.symbol] = {
        currentPrice: pos.currentPrice || (pos.marketValue / pos.qty),
      };
    }
    return detectConflict(currentStyle, positions, stockData);
  }, [currentStyle, positions]);

  // ─── Handle style change ───────────────────────────────────
  const handleChangeStyle = async (style: InvestorStyle) => {
    if (!user || style === currentStyle) { setShowModal(false); return; }
    setUpdating(true);
    try {
      await updateInvestorStyle(user.id, style);
      setProfile(prev => prev ? { ...prev, investorStyle: style } : null);
      setShowModal(false);
    } catch {
      setError('Failed to update style');
    } finally {
      setUpdating(false);
    }
  };

  // ─── Auth guard ───────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
          <RefreshCcw size={24} style={{ color: '#06b6d4', marginBottom: 8, animation: 'spin 1s linear infinite' }} />
          <div style={{ fontSize: 13 }}>Loading...</div>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        Please sign in to manage your investor style.
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 16px 120px', minHeight: '100dvh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Investor Style</h1>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            All analysis filtered through your investment philosophy
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 10, borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#fca5a5', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 0 }}>✕</button>
        </div>
      )}

      {/* Loading profile */}
      {loadingProfile ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>Loading profile...</div>
      ) : (
        <>
          {/* Current Style Banner */}
          <CurrentStyleBanner style={active} />

          {/* What This Affects */}
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 10,
            background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.2)',
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#06b6d4', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              What your style controls
            </div>
            {[
              'Portfolio analysis framework',
              'Stock recommendation filtering',
              'Risk assessment methodology',
              'Rebalancing suggestions',
              'AI advisor conversation context',
              'Sector allocation preferences',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <CheckCircle size={12} style={{ color: '#06b6d4', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{item}</span>
              </div>
            ))}
          </div>

          {/* Change Style Button */}
          <div style={{ marginTop: 14, marginBottom: 16 }}>
            <button
              onClick={() => setShowModal(true)}
              style={{
                width: '100%', padding: '12px 0', borderRadius: 10,
                background: '#06b6d4', color: '#0f172a', border: 'none',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <RefreshCcw size={14} />
              Change Investor Style
            </button>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>
              {profile?.investorStyleSetAt
                ? `Current style set ${new Date(profile.investorStyleSetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : ''}
            </div>
          </div>

          {/* All Styles Grid */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>
              All Investment Styles
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {INVESTOR_STYLES.map(s => (
                <StyleCard
                  key={s.id}
                  style={s}
                  isActive={s.id === currentStyle}
                  onSelect={() => setShowModal(true)}
                />
              ))}
            </div>
          </div>

          {/* Portfolio Conflict */}
          {conflict && (
            <ConflictSection conflict={conflict} />
          )}

          {/* No positions yet */}
          {positions.length === 0 && !loadingProfile && (
            <div style={{
              marginTop: 12, padding: '16px 14px', borderRadius: 10,
              background: '#1e293b', border: '1px solid #334155',
              textAlign: 'center',
            }}>
              <Info size={24} style={{ color: '#475569', marginBottom: 6 }} />
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 2 }}>
                Connect a broker to see style conflicts
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                We'll analyze your portfolio against your chosen style once positions are loaded.
              </div>
            </div>
          )}
        </>
      )}

      {/* Change Style Modal */}
      {showModal && (
        <StyleChangeModal
          styles={INVESTOR_STYLES}
          current={currentStyle}
          updating={updating}
          onConfirm={handleChangeStyle}
          onClose={() => setShowModal(false)}
        />
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ─── Current Style Banner ─────────────────────────────────────
function CurrentStyleBanner({ style }: { style: StyleDef }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a 0%, #1a2332 100%)',
      border: '2px solid #06b6d4', borderRadius: 14, padding: 20,
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Decorative glow */}
      <div style={{
        position: 'absolute', top: -30, right: -30,
        width: 120, height: 120, borderRadius: '50%',
        background: 'rgba(6,182,212,0.06)',
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Badge */}
        <div style={{
          display: 'inline-block', padding: '3px 10px', borderRadius: 20,
          background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)',
          fontSize: 9, fontWeight: 700, color: '#06b6d4', marginBottom: 10,
          textTransform: 'uppercase', letterSpacing: '0.5px',
        }}>
          Your Active Style
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 40, lineHeight: 1 }}>{style.emoji}</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{style.name}</div>
            <div style={{ fontSize: 12, color: '#06b6d4', fontWeight: 600 }}>{style.title}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          {style.philosophy}
        </div>

        {/* Key characteristics */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Pill label="Time Horizon" value={style.timeHorizon} />
          <Pill label="Approach" value={style.description} />
        </div>

        {/* Means */}
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: 'rgba(107,114,128,0.06)' }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.5px' }}>
            What this means for your account
          </div>
          {style.means.map((m, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 3 }}>
              <span style={{ color: '#06b6d4', fontSize: 10, marginTop: 1 }}>•</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{m}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Style Card ───────────────────────────────────────────────
function StyleCard({ style, isActive, onSelect }: { style: StyleDef; isActive: boolean; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      style={{
        padding: 14, borderRadius: 10,
        background: isActive ? 'linear-gradient(135deg, #1a2332 0%, #0f172a 100%)' : '#1e293b',
        border: isActive ? '2px solid #06b6d4' : '1px solid #334155',
        cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
        position: 'relative',
      }}
      className="style-card"
    >
      {isActive && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          padding: '2px 8px', borderRadius: 10,
          background: '#06b6d4', color: '#0f172a',
          fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
        }}>
          Active
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{style.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{style.name}</div>
          <div style={{ fontSize: 10, color: isActive ? '#06b6d4' : 'var(--text-muted)', fontWeight: 600 }}>
            {style.title}
          </div>
        </div>
        {!isActive && (
          <span style={{ fontSize: 16, color: 'var(--text-dim)' }}>→</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5, paddingRight: isActive ? 60 : 0 }}>
        {style.description}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', background: '#0f172a', padding: '2px 8px', borderRadius: 4 }}>
          ⏱ {style.timeHorizon}
        </span>
      </div>
    </div>
  );
}

// ─── Pill ─────────────────────────────────────────────────────
function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', gap: 1,
      padding: '4px 10px', borderRadius: 6,
      background: 'rgba(107,114,128,0.1)', border: '1px solid rgba(107,114,128,0.15)',
    }}>
      <span style={{ fontSize: 7, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</span>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-dim)' }}>{value}</span>
    </span>
  );
}

// ─── Conflict Section ─────────────────────────────────────────
function ConflictSection({ conflict }: { conflict: any }) {
  if (!conflict.hasConflict) {
    return (
      <div style={{
        marginTop: 12, padding: '14px 16px', borderRadius: 10,
        background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckCircle size={16} style={{ color: '#22c55e' }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#22c55e' }}>Portfolio Aligned</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>{conflict.conflictMessage}</div>
          </div>
        </div>
      </div>
    );
  }

  const sevColors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
    low: { bg: 'rgba(250,204,21,0.06)', border: 'rgba(250,204,21,0.2)', text: '#facc15', icon: '#facc15' },
    medium: { bg: 'rgba(249,115,22,0.06)', border: 'rgba(249,115,22,0.2)', text: '#f97316', icon: '#f97316' },
    high: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', text: '#ef4444', icon: '#ef4444' },
  };

  const c = sevColors[conflict.severity] || sevColors.low;

  return (
    <div style={{
      marginTop: 12, padding: '14px 16px', borderRadius: 10,
      background: c.bg, border: `1px solid ${c.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <AlertTriangle size={18} style={{ color: c.icon, flexShrink: 0, marginTop: 1 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: c.text, marginBottom: 2 }}>
            {conflict.severity.toUpperCase()} Portfolio Conflict
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10, lineHeight: 1.5 }}>
            {conflict.conflictMessage}
          </div>

          {/* Metrics */}
          {Object.keys(conflict.metrics).length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                Conflicting Metrics
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(conflict.metrics).map(([key, val]: [string, any]) => (
                  <div key={key} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 10px', borderRadius: 6,
                    background: 'rgba(0,0,0,0.15)',
                  }}>
                    <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600 }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>{val.current}{val.unit ? ` ${val.unit}` : ''}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>→</span>
                      <span style={{ fontSize: 10, color: '#06b6d4', fontWeight: 600 }}>{val.ideal}{val.unit ? ` ${val.unit}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestions */}
          {conflict.suggestions.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                Suggestions
              </div>
              {conflict.suggestions.map((s: string, i: number) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4,
                  padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.1)',
                }}>
                  <TrendingUp size={12} style={{ color: '#06b6d4', flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.4 }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Style Change Modal ───────────────────────────────────────
function StyleChangeModal({
  styles, current, updating, onConfirm, onClose,
}: {
  styles: StyleDef[]; current: string; updating: boolean;
  onConfirm: (style: InvestorStyle) => void; onClose: () => void;
}) {
  const [tempStyle, setTempStyle] = useState<InvestorStyle>(current as InvestorStyle);
  const changing = tempStyle !== current;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: '#0f172a', border: '1px solid #334155', borderRadius: 14,
        maxWidth: 520, width: '100%', maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px', borderBottom: '1px solid #1e293b',
          background: '#0f172a', borderRadius: '14px 14px 0 0',
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Choose Your Style</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            All recommendations and analysis will reflect this investment philosophy
          </div>
        </div>

        {/* Styles */}
        <div style={{ padding: '14px 20px', overflowY: 'auto', maxHeight: '50vh' }}>
          {styles.map(s => {
            const selected = tempStyle === s.id;
            return (
              <label
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: 12, marginBottom: 8, borderRadius: 10,
                  border: selected ? '2px solid #06b6d4' : '2px solid #1e293b',
                  background: selected ? 'rgba(6,182,212,0.06)' : 'transparent',
                  cursor: 'pointer', transition: 'border-color 0.1s, background 0.1s',
                }}
              >
                <input
                  type="radio" name="style-modal" value={s.id}
                  checked={selected}
                  onChange={() => setTempStyle(s.id)}
                  style={{ marginTop: 3, accentColor: '#06b6d4', cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 22 }}>{s.emoji}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontSize: 10, color: selected ? '#06b6d4' : 'var(--text-muted)' }}>
                        {s.title} · {s.timeHorizon}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>
                    {s.philosophy}
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Warning */}
        {changing && (
          <div style={{
            margin: '0 20px 10px', padding: 10, borderRadius: 8,
            background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.3)',
            fontSize: 11, color: '#06b6d4',
          }}>
            ℹ️ You're switching investment philosophies. Your portfolio analysis and AI recommendations will update accordingly.
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '14px 20px', borderTop: '1px solid #1e293b',
          display: 'flex', gap: 10, borderRadius: '0 0 14px 14px',
        }}>
          <button onClick={onClose} disabled={updating} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, background: 'transparent',
            border: '1px solid #475569', color: 'var(--text-dim)',
            fontSize: 13, fontWeight: 600, cursor: updating ? 'default' : 'pointer',
            opacity: updating ? 0.5 : 1,
          }}>Cancel</button>
          <button onClick={() => onConfirm(tempStyle)} disabled={updating || !changing} style={{
            flex: 1, padding: '10px 0', borderRadius: 8, background: '#06b6d4',
            color: '#0f172a', border: 'none', fontSize: 13, fontWeight: 600,
            cursor: updating || !changing ? 'default' : 'pointer',
            opacity: updating || !changing ? 0.5 : 1,
          }}>{updating ? 'Updating...' : 'Confirm Change'}</button>
        </div>
      </div>
    </div>
  );
}
