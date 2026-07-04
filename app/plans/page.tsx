'use client';

// ─── Vantage Plans & Pricing — Comparison Matrix ────────────
// UI only — CTAs are inert ("Coming soon" toast).
// No Stripe, no billing logic. Horizontal scroll on narrow screens
// for the matrix; vertical scroll should never be needed.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Minus } from 'lucide-react';

// ── Tier Definitions ───────────────────────────────────────

interface Tier {
  id: string;
  name: string;
  price: string;
  period: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  ctaLabel: string;
  badge?: string;
  badgeBg?: string;
}

const TIERS: Tier[] = [
  {
    id: 'demo', name: 'Demo', price: 'Free', period: '',
    accent: '#94a3b8', accentBg: 'rgba(148,163,184,0.06)', accentBorder: 'rgba(148,163,184,0.12)',
    ctaLabel: 'Current plan', badge: 'ACTIVE', badgeBg: 'rgba(148,163,184,0.15)',
  },
  {
    id: 'silver', name: 'Silver', price: '$12', period: '/mo',
    accent: '#22d3ee', accentBg: 'rgba(34,211,238,0.06)', accentBorder: 'rgba(34,211,238,0.18)',
    ctaLabel: 'Upgrade to Silver', badge: 'RECOMMENDED', badgeBg: 'rgba(34,211,238,0.18)',
  },
  {
    id: 'gold', name: 'Gold', price: '$29', period: '/mo',
    accent: '#fbbf24', accentBg: 'rgba(251,191,36,0.06)', accentBorder: 'rgba(251,191,36,0.18)',
    ctaLabel: 'Upgrade to Gold',
  },
];

// ── Feature Rows ────────────────────────────────────────────

interface FeatureRow {
  label: string;
  values: { demo: string | boolean; silver: string | boolean; gold: string | boolean };
  group?: string;
}

const FEATURES: FeatureRow[] = [
  // ── AI & Intelligence ──
  { label: 'AI portfolio insights', values: { demo: true, silver: true, gold: true }, group: 'AI & Intelligence' },
  { label: 'AI strategy advisor', values: { demo: true, silver: true, gold: true } },
  { label: 'News sentiment analysis', values: { demo: true, silver: true, gold: true } },
  { label: 'Priority AI processing', values: { demo: false, silver: true, gold: true } },
  { label: 'Custom AI backtesting', values: { demo: false, silver: false, gold: true } },

  // ── Market Data ──
  { label: 'Price alerts & watchlists', values: { demo: true, silver: true, gold: true }, group: 'Market Data' },
  { label: 'Macro calendar', values: { demo: true, silver: true, gold: true } },
  { label: 'Insider trading feed', values: { demo: true, silver: true, gold: true } },
  { label: 'Real-time streaming quotes', values: { demo: false, silver: false, gold: true } },

  // ── Strategies ──
  { label: 'Strategy simulation engine', values: { demo: true, silver: true, gold: true }, group: 'Strategies' },
  { label: 'Tax-loss harvesting', values: { demo: false, silver: true, gold: true } },
  { label: 'Advanced order types', values: { demo: false, silver: false, gold: true } },
  { label: 'One-click strategy deploy', values: { demo: false, silver: false, gold: true } },

  // ── Portfolios ──
  { label: 'Paper trading portfolios', values: { demo: '1', silver: '3', gold: 'Unlimited' }, group: 'Portfolios' },
  { label: 'Real brokerage (read-only)', values: { demo: false, silver: true, gold: true } },
  { label: 'Live trade execution', values: { demo: false, silver: false, gold: true } },
  { label: 'Multi-account aggregation', values: { demo: false, silver: true, gold: true } },

  // ── Security & Support ──
  { label: 'TOTP / hardware 2FA', values: { demo: false, silver: false, gold: true }, group: 'Security & Support' },
  { label: 'Email digests', values: { demo: false, silver: true, gold: true } },
  { label: 'Export to CSV / PDF', values: { demo: false, silver: true, gold: true } },
  { label: 'Priority support', values: { demo: false, silver: false, gold: true } },
];

// ── Helpers ─────────────────────────────────────────────────

function Cell({ value, accent }: { value: string | boolean; accent: string }) {
  if (value === true) {
    return <Check size={14} style={{ color: '#10b981', flexShrink: 0 }} />;
  }
  if (value === false) {
    return <Minus size={14} style={{ color: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />;
  }
  return <span style={{ fontSize: 12, fontWeight: 600, color: accent }}>{value}</span>;
}

export default function PlansPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  const handleCTA = (tierName: string) => {
    setToast(`${tierName} plans coming soon — we'll let you know when subscriptions launch.`);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div style={{
      minHeight: '100dvh',
      height: '100dvh',
      background: '#0b1120',
      color: '#ffffff',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px 6px', flexShrink: 0,
      }}>
        <button onClick={() => router.back()} style={{
          width: 32, height: 32, borderRadius: 8,
          border: 'none', background: 'rgba(255,255,255,0.05)',
          color: '#94a3b8', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ArrowLeft size={16} />
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          Plans &amp; Pricing
        </h1>
      </div>

      {/* ── Matrix Container ── */}
      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'auto',
        padding: '0 12px 12px',
        WebkitOverflowScrolling: 'touch',
      }}>
        <table style={{
          width: '100%', minWidth: 480, borderCollapse: 'collapse',
          tableLayout: 'fixed',
        }}>
          <colgroup>
            <col style={{ width: '40%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
          </colgroup>

          {/* ── Header Row ── */}
          <thead>
            <tr>
              <th style={{ ...thStyle, textAlign: 'left' }}></th>
              {TIERS.map((t) => (
                <th key={t.id} style={{
                  ...thStyle, textAlign: 'center',
                  borderBottom: `2px solid ${t.id === 'silver' ? t.accent : 'rgba(255,255,255,0.06)'}`,
                  background: t.id === 'silver' ? t.accentBg : 'transparent',
                }}>
                  {t.badge && (
                    <div style={{
                      fontSize: 8, fontWeight: 800, letterSpacing: '0.6px',
                      color: t.id === 'silver' ? t.accent : '#94a3b8',
                      background: t.badgeBg,
                      borderRadius: 4, padding: '2px 6px',
                      display: 'inline-block', marginBottom: 4,
                    }}>
                      {t.badge}
                    </div>
                  )}
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                    {t.name}
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: 800, color: '#ffffff',
                    lineHeight: 1.1,
                  }}>
                    {t.price}
                    {t.period && (
                      <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>{t.period}</span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Feature Rows ── */}
          <tbody>
            {FEATURES.map((f, i) => (
              <React.Fragment key={i}>
                {/* Group header */}
                {f.group && (
                  <tr>
                    <td colSpan={4} style={{
                      padding: '10px 8px 4px',
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.8px',
                      color: '#64748b', textTransform: 'uppercase',
                    }}>
                      {f.group}
                    </td>
                  </tr>
                )}
                <tr style={{
                  background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
                }}>
                  <td style={{
                    ...tdStyle, textAlign: 'left', padding: '6px 8px',
                    fontSize: 11, fontWeight: 500, color: '#cbd5e1',
                  }}>
                    {f.label}
                  </td>
                  {TIERS.map((t) => (
                    <td key={t.id} style={{
                      ...tdStyle, textAlign: 'center', padding: '6px 4px',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <Cell value={f.values[t.id as keyof typeof f.values]} accent={t.accent} />
                      </div>
                    </td>
                  ))}
                </tr>
              </React.Fragment>
            ))}
          </tbody>

          {/* ── CTA Row ── */}
          <tfoot>
            <tr>
              <td style={{ padding: '10px 8px 0' }}></td>
              {TIERS.map((t) => (
                <td key={t.id} style={{ padding: '10px 4px 0', textAlign: 'center' }}>
                  <button
                    onClick={() => t.id !== 'demo' && handleCTA(t.name)}
                    disabled={t.id === 'demo'}
                    style={{
                      width: '100%', padding: '8px 4px', borderRadius: 8,
                      border: t.id === 'demo'
                        ? '1px solid rgba(255,255,255,0.06)'
                        : `1px solid ${t.accentBorder}`,
                      background: t.id === 'demo'
                        ? 'transparent'
                        : t.id === 'silver'
                          ? 'linear-gradient(135deg, #22d3ee, #06b6d4)'
                          : t.accentBg,
                      color: t.id === 'demo'
                        ? '#475569'
                        : t.id === 'silver'
                          ? '#000'
                          : t.accent,
                      fontSize: 11, fontWeight: 700,
                      fontFamily: 'var(--font-sans)', cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.ctaLabel}
                  </button>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 'calc(env(safe-area-inset-bottom) + 16px)', left: 12, right: 12,
          zIndex: 200, maxWidth: 420, margin: '0 auto',
          background: 'rgba(34,211,238,0.12)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(34,211,238,0.25)',
          borderRadius: 12, padding: '12px 16px',
          fontSize: 13, fontWeight: 600, color: '#22d3ee',
          textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Shared Styles ───────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '8px 4px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  verticalAlign: 'top',
};

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  verticalAlign: 'middle',
};
