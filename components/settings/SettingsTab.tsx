'use client';

import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api-client';
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client';

import { useState } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { ShareCardModal } from '@/components/sharing/ShareCardModal';
import type { ShareStyleId } from '@/components/sharing/StyleShareCard';
import type { Level } from '@/lib/theme/tokens';
import { useInvestorScore } from '@/hooks/useInvestorScore';

const INVESTOR_STYLES = [
  { id: 'lynch', name: 'Peter Lynch', subtitle: 'Growth Focus', description: 'Find growth before Wall Street does. GARP investing.', emoji: '📈' },
  { id: 'buffett', name: 'Warren Buffett', subtitle: 'Value Focus', description: 'Wonderful companies at fair prices. Think in decades.', emoji: '🏰' },
  { id: 'livermore', name: 'Jesse Livermore', subtitle: 'Momentum Focus', description: 'Follow the tape. Cut losers fast. Ride winners.', emoji: '⚡' },
  { id: 'munger', name: 'Charlie Munger', subtitle: 'Quality Focus', description: 'Extraordinary businesses at fair prices. Concentrate.', emoji: '🎯' },
  { id: 'soros', name: 'George Soros', subtitle: 'Macro Focus', description: 'Find the dislocation. Asymmetric bets. Reflexivity.', emoji: '🌍' },
];

async function saveInvestorStyle(userId: string, style: string): Promise<boolean> {
  try {
    const res = await apiPost('/api/db/users/update', { userId, investorStyle: style });
    if (res.ok) {
      localStorage.setItem('vantage_investor_style', style);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function SettingsTab() {
  const { user } = useAuth() as any;
  const router = useRouter();
  const [riskLevel, setRiskLevel] = useState<'conservative' | 'moderate' | 'aggressive'>('moderate');
  const [brokerConnected, setBrokerConnected] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showStylePicker, setShowStylePicker] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('vantage_investor_style') || user?.investorStyle || 'lynch';
    }
    return user?.investorStyle || 'lynch';
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const { score, level } = useInvestorScore();

  async function selectStyle(styleId: string) {
    setSaving(true);
    const success = user?.id ? await saveInvestorStyle(user.id, styleId) : false;
    setSelectedStyle(styleId);
    // Clear greeting cache so new style is reflected
    try {
      const today = new Date().toDateString().replace(/\s/g, '_');
      localStorage.removeItem(`vantage_greeting_${today}`);
    } catch {}
    setSaving(false);
    setShowStylePicker(false);
    if (success) {
      const styleName = INVESTOR_STYLES.find(s => s.id === styleId)?.name || styleId;
      setToast(`Style updated to ${styleName} · AI will now think like ${styleName}`);
      setTimeout(() => setToast(null), 3500);
    }
  }

  const sectionHeader = (label: string) => (
    <div
      style={{
        padding: '20px 16px 8px 16px',
        fontSize: '11px',
        fontWeight: '600',
        color: '#e2e8f0',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {label}
    </div>
  );

  const riskPill = (level: 'conservative' | 'moderate' | 'aggressive', label: string) => {
    const active = riskLevel === level;
    return (
      <button
        key={level}
        onClick={() => setRiskLevel(level)}
        style={{
          borderRadius: '6px',
          padding: '4px 8px',
          fontSize: '11px',
          fontWeight: '500',
          background: active ? 'rgba(34,211,238,0.2)' : 'transparent',
          color: active ? '#22d3ee' : '#64748b',
          border: active ? '1px solid rgba(34,211,238,0.4)' : '1px solid #334155',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* ═══════════════════════════════════════════════════════
          1. PROFILE
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Profile')}

      <div style={{ margin: '0 16px' }}>
        {/* Investor Style */}
        <div
          onClick={() => setShowStylePicker(true)}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '10px 10px 0 0',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Investor Style</p>
            <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>
              {INVESTOR_STYLES.find(s => s.id === selectedStyle)?.name || 'Peter Lynch'} ·{' '}
              {INVESTOR_STYLES.find(s => s.id === selectedStyle)?.subtitle || 'Growth Focus'} ·{' '}
              shapes all AI responses
            </p>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
        </div>

        {/* Risk Tolerance */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderRadius: '0 0 10px 10px',
            minHeight: '52px',
          }}
        >
          <p style={{ fontSize: '15px', color: '#ffffff' }}>Risk Tolerance</p>
          <div style={{ display: 'flex', gap: '6px' }}>
            {riskPill('conservative', 'Conservative')}
            {riskPill('moderate', 'Moderate')}
            {riskPill('aggressive', 'Aggressive')}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          ACCOUNT
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Account')}

      {/* Demo Status Card */}
      <div
        style={{
          margin: '0 16px 12px 16px',
          background: '#1a2235',
          border: '1px solid rgba(245, 158, 11, 0.2)',
          borderRadius: '12px',
          padding: '16px',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div>
            <p style={{ fontSize: '14px', fontWeight: '700', color: '#ffffff' }}>
              Demo Status
            </p>
            <p style={{ fontSize: '11px', color: '#e2e8f0', marginTop: '2px' }}>
              30-day free trial
            </p>
          </div>
          {/* Tier badge */}
          <span
            style={{
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              fontSize: '10px',
              fontWeight: '700',
              padding: '3px 8px',
              borderRadius: '4px',
              letterSpacing: '0.05em',
            }}
          >
            DEMO
          </span>
        </div>

        {/* Days remaining */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '10px' }}>
          <span style={{ fontSize: '32px', fontWeight: '800', color: '#fbbf24', lineHeight: 1 }}>
            {(() => {
              try {
                const fo = typeof window !== 'undefined' ? localStorage.getItem('vantage_first_open') : null;
                if (!fo) return 30;
                const expires = new Date(fo);
                expires.setDate(expires.getDate() + 30);
                const diff = expires.getTime() - Date.now();
                return Math.max(0, Math.ceil(diff / 86_400_000));
              } catch { return 30; }
            })()}
          </span>
          <span style={{ fontSize: '13px', color: '#e2e8f0' }}>days left</span>
        </div>

        {/* Progress bar */}
        {(() => {
          try {
            const fo = typeof window !== 'undefined' ? localStorage.getItem('vantage_first_open') : null;
            let pct = 0;
            if (fo) {
              const first = new Date(fo).getTime();
              const elapsed = Date.now() - first;
              const total = 30 * 86_400_000;
              pct = Math.min(100, Math.round((elapsed / total) * 100));
            }
            return (
              <div
                style={{
                  height: '6px',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                  marginBottom: '10px',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${pct}%`,
                    background: pct > 90
                      ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                      : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
                    borderRadius: '3px',
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
            );
          } catch { return null; }
        })()}

        {/* Upgrade CTA */}
        <button
          style={{
            width: '100%',
            background: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
            color: '#000000',
            borderRadius: '8px',
            padding: '10px 0',
            fontSize: '13px',
            fontWeight: '700',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Upgrade to Silver
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          INVESTOR IDENTITY
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Investor Identity')}

      <div style={{ margin: '0 16px 12px 16px' }}>
        {/* Style + Score row */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderRadius: '10px',
            marginBottom: '8px',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff', margin: 0 }}>
              {(() => {
                const s = INVESTOR_STYLES.find(s => s.id === selectedStyle);
                return s ? `${s.emoji} ${s.name}` : 'Lynch';
              })()}
            </p>
            <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>
              {level} &middot; {score} pts
            </p>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
        </div>

        {/* View & Share Card button */}
        <button
          onClick={() => setShowShareModal(true)}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: '10px',
            border: 'none',
            background: '#22d3ee',
            color: '#0a0f1e',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: '8px',
          }}
        >
          View &amp; Share Style Card
        </button>

        {/* Retake Quiz */}
        <button
          onClick={() => {
            localStorage.removeItem('vantage_quiz_complete');
            localStorage.removeItem('vantage_investor_style');
            localStorage.removeItem('vantage_risk_tolerance');
            window.location.href = '/onboarding';
          }}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: '10px',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'transparent',
            color: '#e2e8f0',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retake Quiz
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          2. BROKER
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Broker')}

      <div style={{ margin: '0 16px' }}>
        {!brokerConnected ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: '#1a2235',
              borderRadius: '10px',
              minHeight: '52px',
            }}
          >
            <div>
              <p style={{ fontSize: '15px', color: '#ffffff' }}>Connected Broker</p>
              <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>Not connected</p>
            </div>
            <button
              onClick={() => router.push('/broker-setup')}
              style={{
                background: '#22d3ee',
                color: '#000000',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '600',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Connect →
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: '#1a2235',
                borderBottom: '1px solid #0f1829',
                borderRadius: '10px 10px 0 0',
                minHeight: '52px',
                cursor: 'pointer',
              }}
            >
              <div>
                <p style={{ fontSize: '15px', color: '#ffffff' }}>
                  Alpaca ·{' '}
                  <span style={{ color: '#10b981' }}>Connected ✓</span>
                </p>
              </div>
              <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
            </div>
            <div
              onClick={() => setBrokerConnected(false)}
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '14px 16px',
                background: '#1a2235',
                borderRadius: '0 0 10px 10px',
                minHeight: '52px',
                cursor: 'pointer',
              }}
            >
              <p style={{ fontSize: '15px', color: '#ef4444' }}>Disconnect</p>
            </div>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
          3. TOOLS
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Tools')}

      <div style={{ margin: '0 16px' }}>
        {[
          { label: 'Price Alerts', sub: '2 active' },
          { label: 'Earnings Calendar', sub: '10 holdings tracked' },
          { label: 'News Feed', sub: 'AI-curated' },
          { label: 'Trade History', sub: 'All time activity' },
        ].map((row, i, arr) => (
          <div
            key={row.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: '#1a2235',
              borderBottom: i < arr.length - 1 ? '1px solid #0f1829' : 'none',
              borderRadius:
                arr.length === 1
                  ? '10px'
                  : i === 0
                  ? '10px 10px 0 0'
                  : i === arr.length - 1
                  ? '0 0 10px 10px'
                  : 0,
              minHeight: '52px',
              cursor: 'pointer',
            }}
          >
            <div>
              <p style={{ fontSize: '15px', color: '#ffffff' }}>{row.label}</p>
              <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>{row.sub}</p>
            </div>
            <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          4. ACCOUNT
          ═══════════════════════════════════════════════════════ */}
      {sectionHeader('Account')}

      <div style={{ margin: '0 16px' }}>
        {/* Preferences */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '10px 10px 0 0',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Preferences</p>
            <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>Appearance · Security</p>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
        </div>

        {/* Help & Support */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderBottom: '1px solid #0f1829',
            borderRadius: '0 0 10px 10px',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <div>
            <p style={{ fontSize: '15px', color: '#ffffff' }}>Help & Support</p>
            <p style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '2px' }}>Docs · Contact</p>
          </div>
          <span style={{ color: '#94a3b8', fontSize: '18px' }}>›</span>
        </div>
      </div>

      {/* Sign Out — standalone, no card styling */}
      <div style={{ margin: '0 16px', marginTop: '12px' }}>
        <div
          onClick={() => setShowSignOutConfirm(true)}
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '14px 16px',
            background: '#1a2235',
            borderRadius: '10px',
            minHeight: '52px',
            cursor: 'pointer',
          }}
        >
          <p style={{ fontSize: '15px', color: '#ef4444' }}>Sign Out</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════
          5. FOOTER
          ═══════════════════════════════════════════════════════ */}
      <div
        style={{
          textAlign: 'center',
          padding: '24px 16px 8px 16px',
        }}
      >
        <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', letterSpacing: '0.1em' }}>
          Vantage
        </p>
        <p style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>v0.1.0</p>
        <p style={{ fontSize: '11px', color: '#334155', marginTop: '4px' }}>
          AI-First · Mobile-First · Built with ❤️
        </p>
      </div>

      {/* Spacer for bottom nav */}
      <div style={{ height: '120px', flexShrink: 0 }} />

      {/* ═══════════════════════════════════════════════════════
          SIGN OUT CONFIRMATION MODAL
          ═══════════════════════════════════════════════════════ */}
      {showSignOutConfirm && (
        <>
          <div
            onClick={() => setShowSignOutConfirm(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              zIndex: 9998,
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#1a2235',
              border: '1px solid #2a3448',
              borderRadius: '16px',
              padding: '24px',
              width: '100%',
              maxWidth: '360px',
              zIndex: 9999,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🚪</div>
            <p style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff', marginBottom: '8px' }}>
              Sign out of Vantage?
            </p>
            <p style={{ fontSize: '13px', color: '#cbd5e1', marginBottom: '20px' }}>
              You&apos;ll need to sign back in to access your portfolio.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setShowSignOutConfirm(false)}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: 'transparent',
                  border: '1px solid #475569',
                  borderRadius: '10px',
                  color: '#94a3b8',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  try {
                    const supabase = getSupabaseBrowserClient();
                    await supabase.auth.signOut();
                  } catch {}
                  // Clear any local state
                  try { sessionStorage.clear(); } catch {}
                  try { localStorage.removeItem('vantage_investor_style'); } catch {}
                  // Hard navigation — triggers middleware, clears cookies server-side
                  window.location.href = '/';
                }}
                style={{
                  flex: 1,
                  padding: '12px 0',
                  background: '#ef4444',
                  border: 'none',
                  borderRadius: '10px',
                  color: '#ffffff',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          INVESTOR STYLE PICKER MODAL
          ═══════════════════════════════════════════════════════ */}
      {showStylePicker && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#0a0f1e',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}>
            <span style={{ color: '#ffffff', fontWeight: '600', fontSize: '16px' }}>
              Investor Style
            </span>
            <button
              onClick={() => {
                setShowStylePicker(false);
                setSelectedStyle(user?.investorStyle || 'lynch');
              }}
              style={{
                color: '#cbd5e1',
                background: 'none',
                border: 'none',
                fontSize: '22px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          <div style={{
            color: '#cbd5e1',
            fontSize: '13px',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            Your style shapes how Vantage AI thinks, analyzes, and recommends. You can change this anytime.
          </div>

          {/* Style cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', paddingBottom: '100px' }}>
            {INVESTOR_STYLES.map(style => {
              const isActive = selectedStyle === style.id;
              return (
                <div
                  key={style.id}
                  onClick={() => setSelectedStyle(style.id)}
                  style={{
                    background: isActive ? 'rgba(34,211,238,0.08)' : '#1a2235',
                    border: isActive ? '1px solid rgba(34,211,238,0.4)' : '1px solid rgba(255,255,255,0.07)',
                    borderRadius: '14px',
                    padding: '16px',
                    marginBottom: '10px',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <span style={{ fontSize: '24px' }}>{style.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <div>
                          <span style={{ color: '#ffffff', fontWeight: '700', fontSize: '15px' }}>{style.name}</span>
                          <span style={{ color: '#22d3ee', fontSize: '12px', marginLeft: '8px' }}>{style.subtitle}</span>
                        </div>
                        {isActive && (
                          <span style={{ color: '#22d3ee', fontSize: '18px' }}>✓</span>
                        )}
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: '13px', lineHeight: '1.5' }}>{style.description}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom save button */}
          <div style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 10000,
            background: '#0a0f1e',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '12px 16px',
            paddingBottom: 'max(calc(env(safe-area-inset-bottom) + 90px), 100px)',
          }}>
            <button
              onClick={() => selectStyle(selectedStyle)}
              disabled={saving}
              style={{
                width: '100%',
                padding: '14px',
                background: '#22d3ee',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: '600',
                color: '#0a0f1e',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save Style'}
            </button>
          </div>
        </div>
      )}

    </div>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed',
          top: '60px',
          left: '16px',
          right: '16px',
          zIndex: 10001,
          background: '#1a2235',
          border: '1px solid #22d3ee',
          borderRadius: '12px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          animation: 'slideDown 0.25s ease',
        }}>
          <span style={{ fontSize: '13px', color: '#ffffff', flex: 1 }}>{toast}</span>
          <button
            onClick={() => setToast(null)}
            style={{ color: '#cbd5e1', background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', marginLeft: '8px' }}
          >×</button>
        </div>
      )}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      ` }} />

      {/* Share Card Modal */}
      <ShareCardModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        styleId={selectedStyle as ShareStyleId}
        score={score}
        level={level as Level}
        riskTolerance={riskLevel}
      />
    </>
  );
}
