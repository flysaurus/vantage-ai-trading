'use client';

// ─── Vantage Plans Page ───────────────────────────────────
// UI only — CTAs are inert ("Coming soon").
// No Stripe, no billing logic. Pure presentation.
// Design: frosted-glass/cyan system, consistent with the app.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Zap, Shield, Sparkles } from 'lucide-react';

interface Plan {
  id: string;
  name: string;
  price: string;
  period: string;
  accent: string;
  accentBg: string;
  accentBorder: string;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
}

const PLANS: Plan[] = [
  {
    id: 'demo',
    name: 'Demo',
    price: 'Free',
    period: '30-day trial',
    accent: '#94a3b8',
    accentBg: 'rgba(148,163,184,0.08)',
    accentBorder: 'rgba(148,163,184,0.15)',
    features: [
      'AI-powered portfolio insights',
      'Price alerts & watchlists',
      'Macro calendar & earnings dates',
      'Insider trading feed',
      'News intelligence & sentiment',
      'Strategy simulation engine',
      'Investment style quiz',
      '1 portfolio (paper trading)',
    ],
    ctaLabel: 'Current plan',
    highlighted: false,
  },
  {
    id: 'silver',
    name: 'Silver',
    price: '$12',
    period: '/month',
    accent: '#c0c0c0',
    accentBg: 'rgba(192,192,192,0.08)',
    accentBorder: 'rgba(192,192,192,0.20)',
    features: [
      'Everything in Demo, plus:',
      'Connect real brokerage (read-only)',
      'Live portfolio sync via SnapTrade',
      'Multi-account aggregation',
      'Advanced tax-loss harvesting',
      'Priority AI analysis',
      'Export to CSV / PDF reports',
      'Email digests (daily/weekly)',
    ],
    ctaLabel: 'Upgrade to Silver',
    highlighted: true,
  },
  {
    id: 'gold',
    name: 'Gold',
    price: '$29',
    period: '/month',
    accent: '#fbbf24',
    accentBg: 'rgba(251,191,36,0.08)',
    accentBorder: 'rgba(251,191,36,0.20)',
    features: [
      'Everything in Silver, plus:',
      'Live trade execution via Alpaca',
      'One-click strategy deployment',
      'Advanced order types (OCO, bracket)',
      'Real-time streaming quotes',
      'TOTP / hardware 2FA security',
      'Custom AI strategy backtesting',
      'Priority support (same-day)',
    ],
    ctaLabel: 'Upgrade to Gold',
    highlighted: false,
  },
];

export default function PlansPage() {
  const router = useRouter();
  const [toast, setToast] = useState<string | null>(null);

  const handleCTA = (planId: string, planName: string) => {
    if (planId === 'demo') return;
    setToast(`${planName} plans coming soon — we'll let you know when subscriptions launch.`);
    setTimeout(() => setToast(null), 3500);
  };

  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0b1120',
      color: '#ffffff',
      fontFamily: 'var(--font-sans)',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 16px 0',
      }}>
        <button onClick={() => router.back()} style={{
          width: 36, height: 36, borderRadius: 10,
          border: 'none', background: 'rgba(255,255,255,0.05)',
          color: '#e2e8f0', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ArrowLeft size={18} />
        </button>
        <h1 style={{
          fontSize: 20, fontWeight: 700, color: '#ffffff',
          margin: 0, letterSpacing: '-0.3px',
        }}>
          Plans &amp; Pricing
        </h1>
      </div>

      <p style={{
        fontSize: 13, color: '#94a3b8', padding: '0 16px',
        margin: '8px 0 24px', lineHeight: 1.5, maxWidth: 420,
      }}>
        Choose the plan that fits your investing style.
        Upgrade anytime — your data and strategies move with you.
      </p>

      {/* ── Plan Cards ── */}
      <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460 }}>
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onClick={() => handleCTA(plan.id, plan.name)} />
        ))}
      </div>

      {/* ── Fine Print ── */}
      <p style={{
        fontSize: 11, color: '#64748b', textAlign: 'center',
        padding: '24px 16px', maxWidth: 380, margin: '0 auto',
        lineHeight: 1.5,
      }}>
        All prices in USD. Subscriptions are not yet available —
        this page is a preview of planned tiers. Broker connections
        require third-party integration (SnapTrade / Alpaca).
      </p>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 120, left: 16, right: 16,
          zIndex: 200, maxWidth: 420, margin: '0 auto',
          background: 'rgba(34,211,238,0.12)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(34,211,238,0.25)',
          borderRadius: 12, padding: '14px 18px',
          fontSize: 13, fontWeight: 600, color: '#22d3ee',
          textAlign: 'center',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── Plan Card ─────────────────────────────────────────────

function PlanCard({ plan, onClick }: { plan: Plan; onClick: () => void }) {
  const isDemo = plan.id === 'demo';

  return (
    <div style={{
      borderRadius: 16,
      border: `1px solid ${plan.highlighted ? plan.accentBorder : 'rgba(255,255,255,0.06)'}`,
      background: plan.highlighted
        ? `linear-gradient(135deg, ${plan.accentBg}, rgba(15,23,42,0.9))`
        : 'rgba(255,255,255,0.02)',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Highlight badge */}
      {plan.highlighted && (
        <div style={{
          position: 'absolute', top: 0, right: 0,
          background: 'linear-gradient(135deg, #22d3ee, #06b6d4)',
          color: '#000',
          fontSize: 10, fontWeight: 800,
          padding: '4px 12px', borderRadius: '0 14px 0 10px',
          letterSpacing: '0.5px',
        }}>
          RECOMMENDED
        </div>
      )}

      {/* Tier name + price */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{
            fontSize: 18, fontWeight: 700, color: '#ffffff',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            {plan.id === 'demo' && <Zap size={16} style={{ color: plan.accent }} />}
            {plan.id === 'silver' && <Shield size={16} style={{ color: plan.accent }} />}
            {plan.id === 'gold' && <Sparkles size={16} style={{ color: plan.accent }} />}
            {plan.name}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {plan.period}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontSize: 26, fontWeight: 800, color: '#ffffff',
            lineHeight: 1, letterSpacing: '-0.5px',
          }}>
            {plan.price}
          </div>
          {plan.id !== 'demo' && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
              {plan.period}
            </div>
          )}
        </div>
      </div>

      {/* Features */}
      <ul style={{
        listStyle: 'none', padding: 0, margin: '0 0 18px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {plan.features.map((f, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 8,
            fontSize: 13,
            color: f.startsWith('Everything') ? '#cbd5e1' : '#e2e8f0',
            fontWeight: f.startsWith('Everything') ? 600 : 400,
          }}>
            <Check size={14} style={{
              color: plan.id === 'demo' ? '#94a3b8' : '#22d3ee',
              marginTop: 1, flexShrink: 0,
            }} />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <button
        onClick={onClick}
        disabled={isDemo}
        style={{
          width: '100%', padding: '12px 0', borderRadius: 10,
          border: isDemo
            ? '1px solid rgba(255,255,255,0.08)'
            : `1px solid ${plan.accentBorder}`,
          background: isDemo
            ? 'transparent'
            : plan.highlighted
              ? 'linear-gradient(135deg, #22d3ee, #06b6d4)'
              : plan.accentBg,
          color: isDemo
            ? '#64748b'
            : plan.highlighted
              ? '#000'
              : plan.accent,
          fontSize: 14, fontWeight: 700,
          fontFamily: 'var(--font-sans)',
          cursor: isDemo ? 'default' : 'pointer',
          transition: 'all 0.15s',
          opacity: isDemo ? 0.5 : 1,
        }}
      >
        {plan.ctaLabel}
      </button>
    </div>
  );
}
