'use client';

// ─── Vantage Plans & Pricing — Data-Driven Matrix ───────────
// UI only — CTAs are inert ("Coming soon" toast).
// No Stripe, no billing. Features sourced from roadmap only.

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Minus } from 'lucide-react';

// ── Single Config — Edit features here, not in the markup ──

interface Tier {
  id: string;
  name: string;
  price: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  cta: string;
  badge?: string;
  badgeBg?: string;
}

interface Feature {
  label: string;
  demo: string | boolean;
  silver: string | boolean;
  gold: string | boolean;
}

const TIERS: Tier[] = [
  {
    id: 'demo', name: 'Demo', price: 'Free',
    accent: '#94a3b8', accentBg: 'rgba(148,163,184,0.06)',
    accentBorder: 'rgba(148,163,184,0.15)',
    cta: 'Current plan', badge: 'ACTIVE', badgeBg: 'rgba(148,163,184,0.15)',
  },
  {
    id: 'silver', name: 'Silver', price: 'TBD',
    accent: '#22d3ee', accentBg: 'rgba(34,211,238,0.06)',
    accentBorder: 'rgba(34,211,238,0.18)',
    cta: 'Coming soon', badge: 'RECOMMENDED', badgeBg: 'rgba(34,211,238,0.18)',
  },
  {
    id: 'gold', name: 'Gold', price: 'TBD',
    accent: '#fbbf24', accentBg: 'rgba(251,191,36,0.06)',
    accentBorder: 'rgba(251,191,36,0.18)',
    cta: 'Coming soon',
  },
];

const FEATURES: Feature[] = [
  // ── Core Features ──
  { label: 'AI portfolio insights',         demo: true, silver: true,  gold: true },
  { label: 'Price alerts & watchlists',     demo: true, silver: true,  gold: true },
  { label: 'Macro / earnings calendar',     demo: true, silver: true,  gold: true },
  { label: 'AI-curated news feed',          demo: true, silver: true,  gold: true },
  { label: 'Paper trading portfolio',       demo: '1', silver: '1',    gold: '1' },
  { label: 'Investor style quiz',           demo: true, silver: true,  gold: true },
  // ── Brokerage ──
  { label: 'Real brokerage (read-only)',    demo: false, silver: true,  gold: true },
  { label: 'CSV import',                    demo: false, silver: true,  gold: true },
  { label: 'Live trade execution',          demo: false, silver: false, gold: true },
  { label: 'Options & futures',            demo: false, silver: false, gold: true },
  // ── Advanced ──
  { label: 'TOTP 2FA for real-money',       demo: false, silver: false, gold: true },
  { label: 'Tax lot tracking',              demo: false, silver: false, gold: true },
  { label: 'Tax-loss harvesting',          demo: false, silver: false, gold: true },
  { label: 'Excel / CSV portfolio export',  demo: false, silver: false, gold: true },
];

// ── Cell Renderer ───────────────────────────────────────────

function Cell({ value, accent }: { value: string | boolean; accent: string }) {
  if (value === true) return <Check size={13} color="#10b981" />;
  if (value === false) return <Minus size={13} color="rgba(255,255,255,0.10)" />;
  return <span style={{ fontSize: 11, fontWeight: 600, color: accent }}>{value}</span>;
}

// ── Main ────────────────────────────────────────────────────

export default function PlansPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (tier: string) => {
    setToast(`${tier} subscriptions aren't live yet — we'll announce when they launch.`);
    setTimeout(() => setToast(null), 3200);
  };

  return (
    <div style={{
      height: '100dvh', background: '#0b1120', color: '#fff',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
      overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px 4px', flexShrink: 0,
      }}>
        <button onClick={() => router.back()} aria-label="Back" style={{
          width: 28, height: 28, borderRadius: 6,
          border: 'none', background: 'rgba(255,255,255,0.05)',
          color: '#94a3b8', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ArrowLeft size={14} />
        </button>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
          Plans &amp; Pricing
        </h1>
      </div>

      {/* ── Matrix ── */}
      <table style={{
        width: '100%', borderCollapse: 'collapse',
        tableLayout: 'fixed', flex: 1, marginTop: 2,
      }}>
        <colgroup>
          <col style={{ width: '42%' }} />
          <col style={{ width: '19.33%' }} />
          <col style={{ width: '19.33%' }} />
          <col style={{ width: '19.33%' }} />
        </colgroup>

        {/* ── Tier Headers ── */}
        <thead>
          <tr>
            <th style={labelTh}></th>
            {TIERS.map(t => (
              <th key={t.id} style={{
                verticalAlign: 'top', padding: '4px 2px 6px',
                borderBottom: t.id === 'silver'
                  ? `2px solid ${t.accent}`
                  : '2px solid rgba(255,255,255,0.05)',
                background: t.id === 'silver' ? t.accentBg : 'transparent',
              }}>
                {t.badge && (
                  <div style={{
                    fontSize: 7, fontWeight: 800, letterSpacing: '0.5px',
                    color: t.id === 'silver' ? t.accent : '#94a3b8',
                    background: t.badgeBg, borderRadius: 3,
                    padding: '1px 5px', display: 'inline-block', marginBottom: 2,
                  }}>
                    {t.badge}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
                  {t.name}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginTop: 1 }}>
                  {t.price}
                </div>
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Features ── */}
        <tbody>
          {FEATURES.map((f, i) => (
            <tr key={i} style={{
              background: i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent',
            }}>
              <td style={{
                padding: '5px 8px', fontSize: 11, fontWeight: 500,
                color: '#cbd5e1', borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                {f.label}
              </td>
              {TIERS.map(t => (
                <td key={t.id} style={{
                  padding: '5px 2px', textAlign: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}>
                  <Cell value={f[t.id as keyof Pick<Feature, 'demo'|'silver'|'gold'>]} accent={t.accent} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        {/* ── CTAs ── */}
        <tfoot>
          <tr>
            <td style={{ padding: '8px 8px 0' }}></td>
            {TIERS.map(t => (
              <td key={t.id} style={{ padding: '8px 2px 0', textAlign: 'center' }}>
                <button
                  onClick={() => t.id !== 'demo' && showToast(t.name)}
                  disabled={t.id === 'demo'}
                  style={{
                    width: '100%', padding: '6px 2px', borderRadius: 6,
                    border: t.id === 'demo'
                      ? '1px solid rgba(255,255,255,0.05)'
                      : `1px solid ${t.accentBorder}`,
                    background: t.id === 'silver'
                      ? t.accentBg
                      : 'transparent',
                    color: t.id === 'demo'
                      ? '#475569'
                      : t.id === 'silver'
                        ? t.accent
                        : t.accent,
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    cursor: t.id === 'demo' ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.cta}
                </button>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>

      {/* ── Footer ── */}
      <div style={{
        flexShrink: 0, textAlign: 'center', padding: '6px 12px',
        fontSize: 10, color: '#475569',
      }}>
        All prices shown are placeholder. Subscriptions not yet live.
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 'calc(env(safe-area-inset-bottom) + 12px)',
          left: 12, right: 12, zIndex: 200, maxWidth: 400, margin: '0 auto',
          background: 'rgba(34,211,238,0.12)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(34,211,238,0.25)',
          borderRadius: 10, padding: '10px 14px',
          fontSize: 12, fontWeight: 600, color: '#22d3ee',
          textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────

const labelTh: React.CSSProperties = {
  padding: '4px 8px 6px',
  borderBottom: '2px solid rgba(255,255,255,0.05)',
  verticalAlign: 'bottom',
};
