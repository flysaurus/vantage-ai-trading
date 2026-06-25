// ─── StyleReveal ───────────────────────────────────────────
// Full redesign: bg-onboarding-reveal gradient, emoji hero
// with colored glow, two-line typewriter headline, staggered
// tag/description/risk, override pills, white pill CTA.
//
// Layout:
//   TOP:       VantageMark 36px, static (no burst/glow/rotate)
//   EMOJI:     96px hero emoji with radial glow behind
//   HEADLINE:  two-line typewriter (sans 800 + serif italic 400)
//   TAG:       pill badge
//   DESC:      description text
//   RISK:      colored risk badge
//   NARRATOR:  Vantage AI context line
//   OVERRIDE:  5 text-only pills to switch styles
//   CONTINUE:  white pill "Create your account"

'use client';

import React, { useState, useEffect } from 'react';
import { VantageMark } from '@/components/brand/VantageMark';
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

// Per-style glow colors (for the emoji radial glow)
const GLOW_COLORS: Record<InvestorStyleKey, string> = {
  buffett: 'rgba(34,211,238,0.25)',
  lynch: 'rgba(34,211,238,0.25)',
  livermore: 'rgba(16,185,129,0.25)',
  munger: 'rgba(168,85,247,0.25)',
  soros: 'rgba(245,158,11,0.25)',
};

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
  const [showOverride, setShowOverride] = useState(false);

  const trait = getStyleTrait(selectedStyle);
  const tag = getStyleTag(selectedStyle);
  const emoji = getStyleEmoji(selectedStyle);
  const description = getStyleDescription(selectedStyle);
  const glowColor = GLOW_COLORS[selectedStyle];
  const shortLabel = getStyleContent(selectedStyle).shortLabel;

  const riskColor = RISK_COLORS[initialRisk];
  const riskLabel = RISK_LABELS[initialRisk];

  // Two-line typewriter: line 1 starts immediately, line 2 after
  const [line1Done, setLine1Done] = useState(false);
  const { displayText: line1Text, isDone: l1Done } = useTypewriter("You're The", 35, 400);
  const { displayText: line2Text, isDone: l2Done } = useTypewriter(
    line1Done ? `${trait}.` : '',
    30,
    0,
  );

  // Track line 1 done
  useEffect(() => {
    if (l1Done) setLine1Done(true);
  }, [l1Done]);

  // Line 2 done → stagger reveals
  useEffect(() => {
    if (!l2Done) return;
    const t1 = setTimeout(() => setShowTag(true), 200);
    const t2 = setTimeout(() => setShowDescription(true), 500);
    const t3 = setTimeout(() => setShowRisk(true), 700);
    const t4 = setTimeout(() => setShowOverride(true), 900);
    const t5 = setTimeout(() => setShowCta(true), 1100);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); clearTimeout(t5); };
  }, [l2Done]);

  // Handle style override — reset reveals
  const handleOverride = (style: InvestorStyleKey) => {
    if (style === selectedStyle) return;
    setSelectedStyle(style);
    // Reset reveals briefly for cross-fade
    setShowTag(false);
    setShowDescription(false);
    setShowRisk(false);
    // glow changes naturally via selectedStyle
    setTimeout(() => {
      setShowTag(true);
      setTimeout(() => setShowDescription(true), 300);
      setTimeout(() => setShowRisk(true), 200);
    }, 200);
  };

  return (
    <div
      className="bg-onboarding-reveal"
      style={{
        width: '100%',
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '24px',
        paddingTop: 'max(24px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* ── TOP: VantageMark (simple, no burst/glow/rotate) ── */}
      <div style={{ marginBottom: '32px' }}>
        <VantageMark size={36} />
      </div>

      {/* ── EMOJI HERO ── */}
      <div
        style={{
          position: 'relative',
          width: '160px',
          height: '160px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '24px',
        }}
      >
        {/* Radial glow behind emoji */}
        <div
          style={{
            position: 'absolute',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            background: glowColor,
            filter: 'blur(20px)',
            zIndex: 0,
            animation: 'reveal-glow-pulse 3s ease-in-out infinite',
            transition: 'background 400ms var(--ease-out)',
          }}
        />

        <span
          style={{
            fontSize: '96px',
            lineHeight: 1,
            position: 'relative',
            zIndex: 1,
            animation: 'reveal-emoji-bounce 400ms var(--ease-spring) both',
            transition: 'all 200ms var(--ease-out)',
          }}
        >
          {emoji}
        </span>
      </div>

      {/* ── HEADLINE: Two-line typewriter ── */}
      <h1
        style={{
          textAlign: 'center',
          marginBottom: '16px',
          minHeight: '84px',
        }}
      >
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-sans)',
            fontSize: '38px',
            fontWeight: 800,
            color: 'var(--text-primary)',
            lineHeight: 1.1,
          }}
        >
          {line1Text}
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: 'var(--font-serif)',
            fontSize: '38px',
            fontWeight: 400,
            fontStyle: 'italic',
            color: 'var(--accent)',
            lineHeight: 1.1,
            transition: 'all 200ms var(--ease-out)',
          }}
        >
          {line2Text}
        </span>
      </h1>

      {/* ── TAG PILL ── */}
      <div
        style={{
          background: 'rgba(34,211,238,0.10)',
          border: '1px solid rgba(34,211,238,0.30)',
          borderRadius: 'var(--radius-pill)',
          padding: '6px 14px',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          marginBottom: '16px',
          opacity: showTag ? 1 : 0,
          transform: showTag ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out), all 200ms var(--ease-out)',
        }}
      >
        {tag}
      </div>

      {/* ── DESCRIPTION ── */}
      <p
        style={{
          fontSize: '18px',
          color: 'rgba(255,255,255,0.75)',
          fontWeight: 400,
          textAlign: 'center',
          maxWidth: '300px',
          lineHeight: 1.65,
          marginBottom: '16px',
          opacity: showDescription ? 1 : 0,
          transform: showDescription ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
        }}
      >
        {description}
      </p>

      {/* ── RISK BADGE ── */}
      <div
        style={{
          background: 'transparent',
          border: `1px solid ${riskColor}`,
          borderRadius: 'var(--radius-pill)',
          padding: '6px 14px',
          fontSize: '12px',
          fontWeight: 600,
          color: riskColor,
          marginBottom: '24px',
          opacity: showRisk ? 1 : 0,
          transform: showRisk ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
        }}
      >
        {riskLabel} RISK
      </div>

      {/* ── NARRATOR LINE ── */}
      <div
        style={{
          opacity: showOverride ? 1 : 0,
          transition: 'opacity 300ms var(--ease-out)',
          maxWidth: '280px',
          marginBottom: '20px',
        }}
      >
        <p
          style={{
            fontSize: '14px',
            color: 'var(--text-secondary)',
            textAlign: 'center',
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          Your investing style shapes everything in Vantage — your AI advisor, your strategy ideas, your risk settings.
        </p>
      </div>

      {/* ── OVERRIDE PILLS ── */}
      <div
        style={{
          opacity: showOverride ? 1 : 0,
          transition: 'opacity 300ms var(--ease-out)',
          marginBottom: '24px',
          width: '100%',
          maxWidth: '360px',
        }}
      >
        <p
          style={{
            fontSize: '12px',
            color: 'rgba(255,255,255,0.40)',
            textAlign: 'center',
            marginBottom: '12px',
          }}
        >
          Not quite right?
        </p>

        <div
          className="hide-scrollbar"
          style={{
            display: 'flex',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '4px',
          }}
        >
          {ALL_STYLES.map((s) => {
            const isActive = s.id === selectedStyle;
            return (
              <button
                key={s.id}
                onClick={() => handleOverride(s.id)}
                style={{
                  flexShrink: 0,
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-pill)',
                  border: isActive
                    ? '1px solid var(--accent)'
                    : '1px solid rgba(255,255,255,0.15)',
                  background: isActive
                    ? 'rgba(34,211,238,0.10)'
                    : 'transparent',
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  transition: 'all 200ms var(--ease-out)',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {s.shortLabel}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CONTINUE BUTTON ── */}
      <div style={{ width: '100%', maxWidth: '360px', marginTop: 'auto' }}>
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
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: showCta ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: showCta ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: showCta ? 'pointer' : 'default',
            pointerEvents: showCta ? 'auto' : 'none',
            transition: 'opacity 400ms var(--ease-out), background 200ms var(--ease-out)',
            opacity: showCta ? 1 : 0,
          }}
        >
          Create your account
        </button>
      </div>

      {/* ── KEYFRAMES ── */}
      <style>{`
        @keyframes reveal-glow-pulse {
          0%, 100% { opacity: 0.8; }
          50%      { opacity: 0.4; }
        }
        @keyframes reveal-emoji-bounce {
          0%   { transform: scale(0); }
          70%  { transform: scale(1.08); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
