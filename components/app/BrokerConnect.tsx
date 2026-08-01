'use client';

// ─── Broker Connect Screen ─────────────────────────────────
// Shown after user taps "Start my 30-day demo" on Screen 1.
// Calmer, informational energy — smaller orb, broker cards,
// skip CTA that actually calls /api/demo/start.
//
// Props:
//   onBack — slides back to celebration (Screen 1)

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Link, Loader2, TrendingUp, Zap } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

// ── Types ───────────────────────────────────────────────────

interface BrokerConnectProps {
  onBack: () => void;
}

// ── Broker card data ────────────────────────────────────────

interface BrokerCard {
  title: string;
  subtitle: string;
  featureTag: string;
  iconBg: string;
  iconBorder: string;
  tagColor: string;
  icon: React.ReactNode;
  comingSoon?: boolean;
}

const BROKER_CARDS: BrokerCard[] = [
  {
    title: 'Connect your broker',
    subtitle: 'Fidelity, Schwab, Robinhood + 20 more',
    featureTag: 'Read-only portfolio analysis',
    iconBg: 'rgba(34,211,238,0.10)',
    iconBorder: 'rgba(34,211,238,0.20)',
    tagColor: 'rgba(34,211,238,0.60)',
    icon: <Link size={22} color="var(--accent)" />,
    comingSoon: false,
  },
  {
    title: 'Trade with Alpaca',
    subtitle: 'Paper & live trading via secure OAuth',
    featureTag: 'Full trade execution',
    iconBg: 'rgba(16,185,129,0.10)',
    iconBorder: 'rgba(16,185,129,0.20)',
    tagColor: 'rgba(16,185,129,0.60)',
    icon: <TrendingUp size={22} color="var(--gain)" />,
    comingSoon: true,
  },
  {
    title: 'Trade with Tastytrade',
    subtitle: 'Options & futures trading',
    featureTag: 'Full trade execution',
    iconBg: 'rgba(168,85,247,0.10)',
    iconBorder: 'rgba(168,85,247,0.20)',
    tagColor: 'rgba(168,85,247,0.60)',
    icon: <Zap size={22} color="#a855f7" />,
    comingSoon: true,
  },
];

// ── Warmer gradient (different from Screen 1) ───────────────

const GRADIENT = `
  radial-gradient(ellipse 140% 55% at 30% -5%, rgba(34,211,238,0.30) 0%, rgba(99,102,241,0.15) 45%, transparent 70%),
  #0a0f1e
`;

// ── Component ───────────────────────────────────────────────

export function BrokerConnect({ onBack }: BrokerConnectProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Skip CTA: start demo for real ─────────────────────────

  const handleStartDemo = async () => {
    setLoading(true);
    setError('');

    try {
      if (typeof window !== 'undefined') {
        try { localStorage.removeItem('vantage_demo_state_v3'); } catch {}
      }

      const res = await fetch('/api/demo/start', {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Failed to start demo. Try again.');
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Network error. Check your connection.');
      setLoading(false);
    }
  };

  // ══════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: GRADIENT,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          height: 60,
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          flexShrink: 0,
        }}
      >
        {/* Back */}
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 0',
            color: 'var(--text-secondary)',
          }}
        >
          <ChevronLeft size={20} />
          <span
            style={{
              fontSize: 15,
              fontFamily: 'var(--font-sans)',
            }}
          >
            Back
          </span>
        </button>

        {/* Spacer + Center Orb */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <VantageOrb size={36} animate showEntrance={false} />
        </div>

        {/* Balance the layout (same width as back button) */}
        <div style={{ width: 60 }} />
      </div>

      {/* ═══ HEADLINE ═══ */}
      <div style={{ padding: '28px 28px 0', textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 800,
            fontSize: 34,
            color: '#fff',
            lineHeight: 1.05,
          }}
        >
          Your demo is ready.
        </div>
        <div
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 22,
            color: 'rgba(255,255,255,0.70)',
            lineHeight: 1.3,
            marginTop: 6,
          }}
        >
          Want to bring your real portfolio too?
        </div>
      </div>

      {/* ═══ SUBTEXT ═══ */}
      <p
        style={{
          marginTop: 14,
          textAlign: 'center',
          maxWidth: 300,
          marginLeft: 'auto',
          marginRight: 'auto',
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 15,
          color: 'rgba(255,255,255,0.55)',
          lineHeight: 1.6,
          padding: '0 28px',
        }}
      >
        Connect a broker to get AI analysis of your actual holdings alongside your demo portfolio.
      </p>

      {/* ═══ BROKER CARDS ═══ */}
      <div
        style={{
          marginTop: 28,
          padding: '0 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {BROKER_CARDS.map((card) => (
          <div
            key={card.title}
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 20,
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              opacity: 0.75,
            }}
          >
            {/* Left icon */}
            <div
              style={{
                width: 44,
                height: 44,
                background: card.iconBg,
                border: `1px solid ${card.iconBorder}`,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {card.icon}
            </div>

            {/* Center content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 700,
                    fontSize: 16,
                    color: '#fff',
                  }}
                >
                  {card.title}
                </span>
                {card.comingSoon !== false && (
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 600,
                      fontSize: 10,
                      letterSpacing: '0.08em',
                      color: 'var(--warning)',
                      background: 'rgba(245,158,11,0.12)',
                      border: '1px solid rgba(245,158,11,0.30)',
                      padding: '3px 8px',
                      borderRadius: 999,
                    }}
                  >
                    COMING SOON
                  </span>
                )}
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.45)',
                  marginTop: 4,
                }}
              >
                {card.subtitle}
              </div>

              <div
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 500,
                  fontSize: 12,
                  color: card.tagColor,
                  marginTop: 4,
                }}
              >
                {card.featureTag}
              </div>
            </div>

            {/* Right chevron */}
            <ChevronRight
              size={18}
              color="rgba(255,255,255,0.20)"
              style={{ flexShrink: 0 }}
            />
          </div>
        ))}
      </div>

      {/* ═══ CONNECT NOTE ═══ */}
      <p
        style={{
          marginTop: 16,
          textAlign: 'center',
          fontFamily: 'var(--font-sans)',
          fontWeight: 400,
          fontSize: 13,
          color: 'rgba(255,255,255,0.30)',
          padding: '0 28px',
        }}
      >
        Connect via SnapTrade to sync Fidelity, Schwab, Robinhood + 20 more.
      </p>

      {/* ═══ ERROR BANNER ═══ */}
      {error && (
        <div
          style={{
            margin: '16px 20px 0',
            padding: '10px 14px',
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.30)',
            borderRadius: 12,
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--danger)',
          }}
        >
          {error}
        </div>
      )}

      {/* ═══ SKIP CTA ═══ */}
      <div style={{ marginTop: 28, padding: '0 20px 48px' }}>
        <button
          onClick={handleStartDemo}
          disabled={loading}
          style={{
            height: 58,
            width: '100%',
            background: '#fff',
            color: '#000',
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 17,
            border: 'none',
            borderRadius: 999,
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: loading ? 0.8 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2 size={20} style={{ animation: 'spin 0.8s linear infinite' }} />
              Starting demo…
            </>
          ) : (
            'Start with demo for now, connect later →'
          )}
        </button>

        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontWeight: 400,
            fontSize: 12,
            color: 'rgba(255,255,255,0.25)',
            textAlign: 'center',
            marginTop: 10,
          }}
        >
          Broker connections available from Settings anytime.
        </p>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
