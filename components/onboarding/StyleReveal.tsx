// ─── StyleReveal ───────────────────────────────────────────
// Final onboarding reveal: burst-in compass, typewriter headline,
// style tag, description, risk badge, override pills, CTA.
//
// Data stays in React state until account creation —
// no localStorage, no Supabase writes yet.
//
// Three-zone flex layout (full viewport):
//   TOP: CompassMark 60px, burst + glow + idleRotate
//   MIDDLE: emoji + headline + tag + description + risk badge
//   BOTTOM: override pills + CTA

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CompassMark } from '@/components/brand/CompassMark';
import { useTypewriter } from '@/lib/animations/typewriter';
import {
  getStyleContent,
  getStyleTrait,
  getStyleTag,
  getStyleEmoji,
  getStyleDescription,
  ALL_STYLES,
} from '@/lib/content/investor-styles';
import { RISK_COLORS, RISK_LABELS } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';
import ScreenTransition from '@/components/layout/ScreenTransition';

interface StyleRevealProps {
  style: InvestorStyleKey;
  risk: RiskTolerance;
  firstName: string;
  lastName: string;
  onCreateAccount: (data: {
    style: InvestorStyleKey;
    risk: RiskTolerance;
    firstName: string;
    lastName: string;
  }) => void;
}

export function StyleReveal({
  style: initialStyle,
  risk: initialRisk,
  firstName,
  lastName,
  onCreateAccount,
}: StyleRevealProps) {
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyleKey>(initialStyle);
  const [showTag, setShowTag] = useState(false);
  const [showDescription, setShowDescription] = useState(false);
  const [showRisk, setShowRisk] = useState(false);
  const [showCta, setShowCta] = useState(false);

  const styleData = getStyleContent(selectedStyle);
  const trait = getStyleTrait(selectedStyle);
  const tag = getStyleTag(selectedStyle);
  const emoji = getStyleEmoji(selectedStyle);
  const description = getStyleDescription(selectedStyle);
  const headline = `You're ${trait}.`;

  // Typewriter — starts after burst
  const [startTypewriter, setStartTypewriter] = useState(false);
  const { displayText: headlineText, isDone: headlineTyped } = useTypewriter(
    startTypewriter ? headline : '',
    30,
    0,
  );

  const riskColor = RISK_COLORS[initialRisk];
  const riskLabel = RISK_LABELS[initialRisk];

  // Sequence after burst completes
  const handleBurstComplete = () => {
    setTimeout(() => setStartTypewriter(true), 200);
  };

  // Headline typed → show tag
  useEffect(() => {
    if (!headlineTyped) return;
    const t = setTimeout(() => setShowTag(true), 300);
    return () => clearTimeout(t);
  }, [headlineTyped]);

  // Tag shown → show description
  useEffect(() => {
    if (!showTag) return;
    const t = setTimeout(() => setShowDescription(true), 300);
    return () => clearTimeout(t);
  }, [showTag]);

  // Description shown → show risk badge
  useEffect(() => {
    if (!showDescription) return;
    const t = setTimeout(() => setShowRisk(true), 200);
    return () => clearTimeout(t);
  }, [showDescription]);

  // Risk badge shown → show CTA
  useEffect(() => {
    if (!showRisk) return;
    const t = setTimeout(() => setShowCta(true), 500);
    return () => clearTimeout(t);
  }, [showRisk]);

  return (
    <ScreenTransition direction="up" transitionKey="style-reveal">
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px',
          paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
          overflow: 'auto',
        }}
      >
        {/* TOP: CompassMark with burst */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <CompassMark
            size={60}
            showBurst
            glow
            idleRotate
            onBurstComplete={handleBurstComplete}
          />
        </div>

        {/* MIDDLE: content */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            maxWidth: '360px',
          }}
        >
          {/* Emoji */}
          <span
            style={{
              fontSize: '80px',
              lineHeight: 1,
              marginBottom: 'var(--space-4)',
              opacity: startTypewriter ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out)',
            }}
          >
            {emoji}
          </span>

          {/* Headline typewriter */}
          <h1
            style={{
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              color: 'var(--text-primary)',
              textAlign: 'center',
              marginBottom: 'var(--space-3)',
              minHeight: '40px',
            }}
          >
            {headlineText}
          </h1>

          {/* Style tag pill */}
          <div
            style={{
              background: 'var(--accent-10)',
              border: '1px solid var(--accent-30)',
              borderRadius: 'var(--radius-pill)',
              padding: '4px 12px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-4)',
              opacity: showTag ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out)',
            }}
          >
            {tag}
          </div>

          {/* Description */}
          <p
            style={{
              fontSize: 'var(--text-lg)',
              color: 'var(--onb-body-color, rgba(255,255,255,0.82))',
              textAlign: 'center',
              maxWidth: '300px',
              lineHeight: 1.6,
              marginBottom: 'var(--space-4)',
              opacity: showDescription ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out)',
            }}
          >
            {description}
          </p>

          {/* Risk badge */}
          <div
            style={{
              background: 'transparent',
              border: `1px solid ${riskColor}`,
              borderRadius: 'var(--radius-pill)',
              padding: '4px 12px',
              fontSize: '11px',
              fontWeight: 600,
              color: riskColor,
              letterSpacing: '0.08em',
              opacity: showRisk ? 1 : 0,
              transition: 'opacity 200ms var(--ease-out)',
            }}
          >
            {riskLabel} RISK
          </div>
        </div>

        {/* BOTTOM: Override pills + CTA */}
        <div style={{ width: '100%', maxWidth: '360px' }}>
          {/* Override section */}
          <p
            style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              textAlign: 'center',
              marginBottom: 'var(--space-3)',
              opacity: showCta ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out)',
            }}
          >
            Not quite right?
          </p>

          {/* Style override pills — horizontal scroll */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              paddingBottom: 'var(--space-4)',
              opacity: showCta ? 1 : 0,
              transition: 'opacity 300ms var(--ease-out)',
            }}
          >
            {ALL_STYLES.map((s) => {
              const isActive = s.id === selectedStyle;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedStyle(s.id)}
                  style={{
                    flexShrink: 0,
                    width: '72px',
                    height: '52px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '2px',
                    background: isActive ? 'var(--accent-10)' : 'transparent',
                    border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all 200ms var(--ease-out)',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                >
                  <span style={{ fontSize: '18px', lineHeight: 1 }}>{s.emoji}</span>
                  <span style={{ fontSize: '9px', color: 'var(--text-secondary)', lineHeight: 1 }}>{s.shortLabel}</span>
                </button>
              );
            })}
          </div>

          {/* CTA */}
          <button
            onClick={() =>
              onCreateAccount({
                style: selectedStyle,
                risk: initialRisk,
                firstName,
                lastName,
              })
            }
            disabled={!showCta}
            style={{
              width: '100%',
              height: 'var(--height-button)',
              background: showCta ? 'var(--accent)' : 'transparent',
              border: showCta ? 'none' : '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-button)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: showCta ? '#000' : 'var(--text-muted)',
              cursor: showCta ? 'pointer' : 'default',
              fontFamily: 'inherit',
              pointerEvents: showCta ? 'auto' : 'none',
              transition: 'opacity 400ms var(--ease-out), background 300ms var(--ease-out), color 300ms var(--ease-out)',
            }}
          >
            Create your account →
          </button>
        </div>
      </div>
    </ScreenTransition>
  );
}
