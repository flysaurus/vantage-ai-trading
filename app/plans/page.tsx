'use client';

// ─── Vantage Plans & Pricing — DB-Driven Matrix ─────────────
// Features and tiers are sourced from Supabase via /api/plans.
// UI only — CTAs are inert ("Coming soon" toast). No Stripe.

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Minus } from 'lucide-react';
import BackButton from '@/components/shared/BackButton';

// ── API Types ───────────────────────────────────────────────

interface TierData {
  key: string;
  name: string;
  priceLabel: string;
  accentColor: string;
  accentBg: string;
  accentBorder: string;
  badgeText: string | null;
  badgeBg: string | null;
  ctaLabel: string;
  isDefault: boolean;
}

interface FeatureData {
  key: string;
  label: string;
  description: string | null;
  values: Record<string, string>;
}

// ── Cell Renderer ───────────────────────────────────────────

function Cell({ value, accent }: { value: string; accent: string }) {
  if (value === 'true') return <Check size={13} color="#10b981" />;
  if (value === 'false') return <Minus size={13} color="rgba(255,255,255,0.10)" />;
  return <span style={{ fontSize: 11, fontWeight: 600, color: accent }}>{value}</span>;
}

// ── Main ────────────────────────────────────────────────────

export default function PlansPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);
  const [tiers, setTiers] = useState<TierData[] | null>(null);
  const [features, setFeatures] = useState<FeatureData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchPlans = useCallback(async () => {
    try {
      setLoading(true);
      setError(false);
      const res = await fetch('/api/plans');
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setTiers(data.tiers);
      setFeatures(data.features);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  const showToast = (tier: string) => {
    setToast(`${tier} subscriptions aren't live yet — we'll announce when they launch.`);
    setTimeout(() => setToast(null), 3200);
  };

  // ── Loading ────────────────────────────────────────

  if (loading) {
    return (
      <div style={{
        height: '100dvh', background: '#0b1120',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          border: '2.5px solid rgba(255,255,255,0.10)',
          borderTopColor: '#22d3ee',
          animation: 'spin 0.6s linear infinite',
        }} />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────

  if (error || !tiers || !features) {
    return (
      <div style={{
        height: '100dvh', background: '#0b1120', color: '#fff',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        padding: 24, textAlign: 'center',
      }}>
        <div style={{ fontSize: 14, color: '#f87171', fontWeight: 600 }}>
          Couldn&apos;t load plans
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>
          Check your connection and try again.
        </div>
        <button
          onClick={fetchPlans}
          style={{
            marginTop: 4, padding: '8px 20px', borderRadius: 8,
            border: '1px solid rgba(34,211,238,0.3)', background: 'rgba(34,211,238,0.10)',
            color: '#22d3ee', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Main View ──────────────────────────────────────

  return (
    <div style={{
      minHeight: '100dvh', background: '#0b1120', color: '#fff',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px 4px', flexShrink: 0,
      }}>
        <BackButton
          tab="settings"
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'rgba(255,255,255,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        />
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
          <col style={{ width: `${58 / 3}%` }} />
          <col style={{ width: `${58 / 3}%` }} />
          <col style={{ width: `${58 / 3}%` }} />
        </colgroup>

        {/* ── Tier Headers ── */}
        <thead>
          <tr>
            <th style={labelTh}></th>
            {tiers.map(t => {
              const isHighlighted = !t.isDefault && t.key === 'silver';
              return (
                <th key={t.key} style={{
                  verticalAlign: 'top', padding: '4px 2px 6px',
                  borderBottom: isHighlighted
                    ? `2px solid ${t.accentColor}`
                    : '2px solid rgba(255,255,255,0.05)',
                  background: isHighlighted ? t.accentBg : 'transparent',
                }}>
                  {t.badgeText && (
                    <div style={{
                      fontSize: 7, fontWeight: 800, letterSpacing: '0.5px',
                      color: isHighlighted ? t.accentColor : '#94a3b8',
                      background: t.badgeBg || 'rgba(255,255,255,0.08)',
                      borderRadius: 3, padding: '1px 5px',
                      display: 'inline-block', marginBottom: 2,
                    }}>
                      {t.badgeText}
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginTop: 1 }}>
                    {t.priceLabel}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>

        {/* ── Features ── */}
        <tbody>
          {features.map((f, i) => (
            <tr key={f.key} style={{
              background: i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent',
            }}>
              <td style={{
                padding: '5px 8px', fontSize: 11, fontWeight: 500,
                color: '#cbd5e1', borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                {f.label}
              </td>
              {tiers.map(t => (
                <td key={t.key} style={{
                  padding: '5px 2px', textAlign: 'center',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                }}>
                  <Cell
                    value={f.values[t.key] || 'false'}
                    accent={t.accentColor}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>

        {/* ── CTAs ── */}
        <tfoot>
          <tr>
            <td style={{ padding: '8px 8px 0' }}></td>
            {tiers.map(t => (
              <td key={t.key} style={{ padding: '8px 2px 0', textAlign: 'center' }}>
                <button
                  onClick={() => !t.isDefault && showToast(t.name)}
                  disabled={t.isDefault}
                  style={{
                    width: '100%', padding: '6px 2px', borderRadius: 6,
                    border: t.isDefault
                      ? '1px solid rgba(255,255,255,0.05)'
                      : `1px solid ${t.accentBorder}`,
                    background: t.key === 'silver'
                      ? t.accentBg
                      : 'transparent',
                    color: t.isDefault
                      ? '#475569'
                      : t.accentColor,
                    fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    cursor: t.isDefault ? 'default' : 'pointer',
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
