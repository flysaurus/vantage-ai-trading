// ─── StyleReveal ───────────────────────────────────────────
// No orb, no constellation. The emoji IS the mark.
// 140px emoji hero wrapper (72px emoji inside) with per-style
// colored glow. Override pills change emoji+glow+headline
// simultaneously. Word-highlight description animation.
//
// Layout (fits iPhone 14 without scroll):
//   EMOJI:     emoji hero with colored glow halo
//   HEADLINE:  two-line typewriter (sans 800 + serif italic)
//   TAG:       pill badge
//   DESC:      word-by-word highlight animation
//   RISK:      colored risk badge (normal flow)
//   NARRATOR:  context line
//   OVERRIDE:  5 text-only pills, horizontal scroll
//   TOAST:     confirmation after override
//   CONTINUE:  white pill "Create your account"

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTypewriter } from '@/lib/animations/typewriter';
import { useWordHighlight } from '@/hooks/useWordHighlight';
import {
  getStyleContent,
  getStyleTag,
  getStyleEmoji,
  getStyleDescription,
  ALL_STYLES,
} from '@/lib/content/investor-styles';
import { RISK_COLORS, RISK_LABELS } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// Per-style glow — radial background + box-shadow
const STYLE_GLOW: Record<InvestorStyleKey, { bg: string; shadow: string }> = {
  buffett: {
    bg: 'radial-gradient(circle, rgba(34,211,238,0.35) 0%, transparent 70%)',
    shadow: '0 0 60px rgba(34,211,238,0.30), 0 0 120px rgba(34,211,238,0.15)',
  },
  lynch: {
    bg: 'radial-gradient(circle, rgba(34,211,238,0.35) 0%, transparent 70%)',
    shadow: '0 0 60px rgba(34,211,238,0.30), 0 0 120px rgba(34,211,238,0.15)',
  },
  livermore: {
    bg: 'radial-gradient(circle, rgba(16,185,129,0.35) 0%, transparent 70%)',
    shadow: '0 0 60px rgba(16,185,129,0.30), 0 0 120px rgba(16,185,129,0.15)',
  },
  munger: {
    bg: 'radial-gradient(circle, rgba(168,85,247,0.35) 0%, transparent 70%)',
    shadow: '0 0 60px rgba(168,85,247,0.30), 0 0 120px rgba(168,85,247,0.15)',
  },
  soros: {
    bg: 'radial-gradient(circle, rgba(245,158,11,0.35) 0%, transparent 70%)',
    shadow: '0 0 60px rgba(245,158,11,0.30), 0 0 120px rgba(245,158,11,0.15)',
  },
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
  const [showRisk, setShowRisk] = useState(false);
  const [showCta, setShowCta] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [emojiPhase, setEmojiPhase] = useState<'entering' | 'visible'>('entering');
  const [emojiOpacity, setEmojiOpacity] = useState(1);
  const [descVisible, setDescVisible] = useState(false);

  // Override confirmation toast
  const [toastText, setToastText] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const tag = getStyleTag(selectedStyle);
  const emoji = getStyleEmoji(selectedStyle);
  const description = getStyleDescription(selectedStyle);
  const { bg: glowBg, shadow: glowShadow } = STYLE_GLOW[selectedStyle];
  const shortLabel = getStyleContent(selectedStyle).shortLabel;

  const riskColor = RISK_COLORS[initialRisk];
  const riskLabel = RISK_LABELS[initialRisk];

  // ── Word highlight callback (fires on completion) ──────
  const handleWordHighlightComplete = () => {
    setShowRisk(true);
    setTimeout(() => setShowOverride(true), 300);
  };

  // ── Word highlight hook (paused until descVisible) ─────
  const {
    words,
    activeIndex: activeWordIndex,
    completedIndices,
    isComplete: wordsComplete,
    skip: skipWords,
  } = useWordHighlight(description, 200, !descVisible, handleWordHighlightComplete);

  // ── Typewriter headlines ─────────────────────────────────
  const [line1Done, setLine1Done] = useState(false);
  const { displayText: line1Text, isDone: l1Done } = useTypewriter("You're The", 35, 400);
  const { displayText: line2Text, isDone: l2Done } = useTypewriter(
    line1Done ? `${shortLabel}.` : '',
    30,
    0,
  );

  useEffect(() => {
    if (l1Done) setLine1Done(true);
  }, [l1Done]);

  // ── Emoji spring entrance ────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setEmojiPhase('visible'), 100);
    return () => clearTimeout(t);
  }, []);

  // ── Line 2 done → stagger reveals ──────────────────────
  useEffect(() => {
    if (!l2Done) return;
    const t1 = setTimeout(() => setShowTag(true), 200);
    const t2 = setTimeout(() => setDescVisible(true), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [l2Done]);

  // ── Words complete → show CTA after delay ───────────────
  useEffect(() => {
    if (!wordsComplete) return;
    const t = setTimeout(() => setShowCta(true), 400);
    return () => clearTimeout(t);
  }, [wordsComplete]);

  // ── Override: emoji cross-fade, rerun animation ─────────
  const handleOverride = (style: InvestorStyleKey) => {
    if (style === selectedStyle) return;
    setEmojiOpacity(0);
    setShowTag(false);
    setDescVisible(false);
    setShowRisk(false);
    setShowOverride(false);
    const label = getStyleContent(style).shortLabel;
    setTimeout(() => {
      setSelectedStyle(style);
      setEmojiOpacity(1);

      // Show confirmation toast
      setToastText(`Updated to ${label}`);
      setToastVisible(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToastVisible(false);
        setTimeout(() => setToastText(null), 200);
      }, 1500);

      // Re-stagger
      setTimeout(() => {
        setShowTag(true);
        setTimeout(() => setDescVisible(true), 300);
      }, 150);
    }, 150);
  };

  // ── Tap-to-skip word highlight ──────────────────────────
  const handleScreenTap = () => {
    if (descVisible && !wordsComplete) skipWords();
  };

  return (
    <div
      className="bg-onboarding-reveal"
      onClick={handleScreenTap}
      style={{
        width: '100%',
        height: '100dvh',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '36px 24px 32px',
        gap: 0,
      }}
    >
      {/* ── EMOJI HERO ── */}
      <div
        style={{
          width: '140px',
          height: '140px',
          position: 'relative',
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        {/* Glow halo */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: glowBg,
            boxShadow: glowShadow,
            filter: 'blur(30px)',
            zIndex: 0,
            animation: 'reveal-glow-breathe 3s ease-in-out infinite',
            transition: 'background 300ms var(--ease-out), box-shadow 300ms var(--ease-out)',
          }}
        />

        {/* Emoji */}
        <span
          style={{
            fontSize: '72px',
            position: 'relative',
            zIndex: 1,
            display: 'block',
            textAlign: 'center',
            lineHeight: '140px',
            transform: emojiPhase === 'entering'
              ? 'scale(0)'
              : 'scale(1)',
            transition: 'transform 500ms cubic-bezier(0.34,1.56,0.64,1)',
            opacity: emojiOpacity,
          }}
        >
          {emoji}
        </span>
      </div>

      {/* ── HEADLINE: Two-line typewriter ── */}
      <h1
        style={{
          textAlign: 'center',
          marginBottom: '10px',
          flexShrink: 0,
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
          marginBottom: '12px',
          opacity: showTag ? 1 : 0,
          transform: showTag ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
          flexShrink: 0,
        }}
      >
        {tag}
      </div>

      {/* ── DESCRIPTION: Word highlight animation ── */}
      <p
        style={{
          fontSize: '17px',
          fontWeight: 400,
          textAlign: 'center',
          maxWidth: '300px',
          lineHeight: 1.55,
          marginBottom: '14px',
          minHeight: '48px',
          opacity: descVisible ? 1 : 0,
          transform: descVisible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
        }}
      >
        {words.map((word, i) => {
          const isActive = activeWordIndex === i;
          const isCompleted = completedIndices.has(i);

          return (
            <span
              key={`${i}-${word}`}
              style={{
                color: isActive
                  ? 'rgba(34,211,238,1.0)'
                  : isCompleted
                    ? 'rgba(255,255,255,0.85)'
                    : 'rgba(255,255,255,0.25)',
                textShadow: isActive
                  ? '0 0 20px rgba(34,211,238,0.6), 0 0 40px rgba(34,211,238,0.3)'
                  : 'none',
                transition: isActive
                  ? 'color 60ms ease-out, text-shadow 60ms ease-out'
                  : 'color 120ms ease-out, text-shadow 120ms ease-out',
                display: 'inline',
              }}
            >
              {word}
              {i < words.length - 1 ? ' ' : ''}
            </span>
          );
        })}
      </p>

      {/* ── RISK BADGE (normal flow, below description) ── */}
      <div
        style={{
          background: 'transparent',
          border: `1px solid ${riskColor}`,
          borderRadius: 'var(--radius-pill)',
          padding: '6px 14px',
          fontSize: '12px',
          fontWeight: 600,
          color: riskColor,
          marginBottom: '16px',
          opacity: showRisk ? 1 : 0,
          transform: showRisk ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 300ms var(--ease-out), transform 300ms var(--ease-out)',
          flexShrink: 0,
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
          marginBottom: '16px',
          flexShrink: 0,
        }}
      >
        <p
          style={{
            fontSize: '12px',
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
          marginBottom: '16px',
          width: '100%',
          maxWidth: '360px',
          flexShrink: 0,
        }}
      >
        <p
          style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.35)',
            textAlign: 'center',
            marginBottom: '6px',
          }}
        >
          Not quite right?
        </p>

        <div
          className="hide-scrollbar"
          style={{
            display: 'flex',
            gap: '10px',
            overflowX: 'auto',
            scrollbarWidth: 'none' as const,
            WebkitOverflowScrolling: 'touch',
            padding: '4px 0',
          }}
        >
          {ALL_STYLES.map((s) => {
            const isActive = s.id === selectedStyle;
            return (
              <button
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOverride(s.id);
                }}
                style={{
                  flexShrink: 0,
                  padding: '8px 16px',
                  borderRadius: '999px',
                  border: isActive
                    ? '1px solid var(--accent)'
                    : '1px solid rgba(255,255,255,0.15)',
                  background: isActive
                    ? 'rgba(34,211,238,0.10)'
                    : 'transparent',
                  color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.45)',
                  fontSize: '13px',
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  whiteSpace: 'nowrap' as const,
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

      {/* ── OVERRIDE CONFIRMATION TOAST ── */}
      {toastText && (
        <div
          style={{
            background: 'rgba(34,211,238,0.12)',
            border: '1px solid rgba(34,211,238,0.30)',
            borderRadius: '999px',
            padding: '6px 14px',
            fontSize: '13px',
            color: 'var(--accent)',
            textAlign: 'center' as const,
            marginBottom: '12px',
            opacity: toastVisible ? 1 : 0,
            transition: 'opacity 200ms var(--ease-out)',
            flexShrink: 0,
          }}
        >
          {toastText}
        </div>
      )}

      {/* ── CONTINUE BUTTON ── */}
      <div style={{ width: '100%', maxWidth: '360px', flexShrink: 0 }}>
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
            borderRadius: '999px',
            border: 'none',
            background: showCta ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: showCta ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: showCta ? 'pointer' : 'default',
            pointerEvents: showCta ? 'auto' : 'none',
            marginTop: '8px',
            transition: 'opacity 400ms var(--ease-out), background 200ms var(--ease-out)',
            opacity: showCta ? 1 : 0,
          }}
        >
          Create your account
        </button>
      </div>

      {/* ── KEYFRAMES ── */}
      <style>{`
        @keyframes reveal-glow-breathe {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50%      { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
