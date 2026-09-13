// ─── BrokerChoiceStep ───────────────────────────────────────
// Internal step inside OnboardingFlow. Reached after
// style-reveal, before create-account. Selection advances
// OnboardingFlow state — no API calls here.
//
// API calls for demo activation / broker connection happen
// later on /welcome after email confirmation.

'use client';

import React, { useState } from 'react';
import { NetworkIcon } from '@/components/brand/NetworkIcon';

// ── Props ───────────────────────────────────────────────────

interface BrokerChoiceStepProps {
  onSelectDemo: () => void;
  onSelectBroker: () => void;
  onBack: () => void;
}

// ── Card data ───────────────────────────────────────────────

const CARDS = {
  demo: {
    icon: '🎮',
    title: 'Start with demo',
    subtitle: '$100,000 paper portfolio \u00b7 Free \u00b7 30 days',
  },
  broker: {
    icon: '🔗',
    title: 'Connect your broker',
    subtitle: 'Sync your real portfolio \u00b7 Requires upgrade',
  },
} as const;

// ── Component ──────────────────────────────────────────────

export default function BrokerChoiceStep({
  onSelectDemo,
  onSelectBroker,
  onBack,
}: BrokerChoiceStepProps) {
  const [hovered, setHovered] = useState<'demo' | 'broker' | null>(null);

  return (
    <div
      className="onboarding-shell"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        background:
          'radial-gradient(ellipse 100% 60% at 50% 0%, var(--v-accent-dim) 0%, transparent 72%), radial-gradient(ellipse 60% 40% at 80% 100%, var(--v-glow) 0%, transparent 60%), var(--v-canvas)',
        color: 'var(--v-text-primary)',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ═══ TOP BAR ═══ */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          minHeight: '60px',
          position: 'relative',
        }}
      >
        {/* Left: Back */}
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--v-text-secondary)',
            fontSize: '14px',
            fontWeight: 400,
            cursor: 'pointer',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontFamily: 'var(--font-sans)',
            minHeight: '44px',
            WebkitTapHighlightColor: 'transparent',
            zIndex: 1,
          }}
          aria-label="Back to style reveal"
        >
          ‹ Back
        </button>

        {/* Center: VantageOrb */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <NetworkIcon size={44} />
        </div>

        {/* Right: spacer for balance */}
        <div style={{ width: '60px' }} />
      </div>

      {/* ═══ CONTENT ═══ */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 20px',
        }}
      >
        {/* ── HEADLINE ── */}
        <h2
          style={{
            margin: '0 0 8px',
            textAlign: 'center',
            lineHeight: 1.15,
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '32px',
              fontWeight: 800,
              color: 'var(--v-text-primary)',
            }}
          >
            How do you want
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '32px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--v-text-primary)',
            }}
          >
            to get started?
          </span>
        </h2>

        {/* ── SUBTEXT ── */}
        <p
          style={{
            fontSize: '14px',
            fontWeight: 400,
            color: 'var(--v-text-muted)',
            textAlign: 'center',
            margin: '0 0 32px',
            lineHeight: 1.5,
            maxWidth: '320px',
          }}
        >
          Start with a $100k demo portfolio,
          or connect your real broker.
        </p>

        {/* ── CARDS ── */}
        <div
          style={{
            width: '100%',
            maxWidth: '380px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          {/* ── Demo card ── */}
          <button
            onClick={onSelectDemo}
            onMouseEnter={() => setHovered('demo')}
            onMouseLeave={() => setHovered(null)}
            style={{
              width: '100%',
              padding: '20px',
              borderRadius: '16px',
              border: hovered === 'demo'
                ? '2px solid var(--v-accent)'
                : '2px solid var(--v-card-border)',
              background: hovered === 'demo'
                ? 'var(--v-accent-dim)'
                : 'var(--v-card)',
              boxShadow: 'var(--v-shadow-card)', // locked elevation
              cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
              textAlign: 'left' as const,
              fontFamily: 'var(--font-sans)',
              color: 'var(--v-text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Icon */}
              <span
                style={{
                  fontSize: '36px',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {CARDS.demo.icon}
              </span>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 700,
                    marginBottom: '4px',
                  }}
                >
                  {CARDS.demo.title}
                </div>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--v-text-muted)',
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {CARDS.demo.subtitle}
                </p>
              </div>
            </div>
          </button>

          {/* ── Broker card ── */}
          <button
            onClick={onSelectBroker}
            onMouseEnter={() => setHovered('broker')}
            onMouseLeave={() => setHovered(null)}
            style={{
              width: '100%',
              padding: '20px',
              borderRadius: '16px',
              border: hovered === 'broker'
                ? '2px solid var(--v-accent)'
                : '2px solid var(--v-card-border)',
              background: hovered === 'broker'
                ? 'var(--v-accent-dim)'
                : 'var(--v-card)',
              boxShadow: 'var(--v-shadow-card)', // locked elevation
              cursor: 'pointer',
              transition: 'border-color 0.2s, background 0.2s',
              textAlign: 'left' as const,
              fontFamily: 'var(--font-sans)',
              color: 'var(--v-text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Icon */}
              <span
                style={{
                  fontSize: '36px',
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                {CARDS.broker.icon}
              </span>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 700,
                    marginBottom: '4px',
                  }}
                >
                  {CARDS.broker.title}
                </div>
                <p
                  style={{
                    fontSize: '13px',
                    color: 'var(--v-text-muted)',
                    margin: 0,
                    lineHeight: 1.4,
                  }}
                >
                  {CARDS.broker.subtitle}
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* ═══ BOTTOM NOTE ═══ */}
        <p
          style={{
            marginTop: '24px',
            fontSize: '12px',
            fontWeight: 400,
            color: 'var(--v-text-faint)',
            textAlign: 'center',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1.5,
          }}
        >
          You can always connect a broker later from Settings.
        </p>
      </div>
    </div>
  );
}
