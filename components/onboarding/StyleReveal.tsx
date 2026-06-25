// ─── StyleReveal ───────────────────────────────────────────
// The emoji IS the mark. No orb, no constellation.
// Orbs only in the top bar (36px, static).
//
// HARD FIX layout: fixed 60px top bar with VantageOrb,
// scrollable content area below. ALL children in normal
// document flow — no position: absolute except glow layer
// inside emoji-wrap. No transform: translateY animations.
// Opacity-only reveals.

'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useTypewriter } from '@/lib/animations/typewriter';
import { useWordHighlight } from '@/hooks/useWordHighlight';
import { ChevronLeft } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import {
  getStyleContent,
  getStyleTag,
  getStyleEmoji,
  getStyleDescription,
  ALL_STYLES,
} from '@/lib/content/investor-styles';
import { RISK_COLORS, RISK_LABELS } from '@/lib/onboarding/quiz-logic';
import type { InvestorStyleKey, RiskTolerance } from '@/lib/onboarding/onboarding-state';

// Per-style glow colors
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
  onBack?: () => void;
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
  onBack,
  onCreateAccount,
}: StyleRevealProps) {
  const [selectedStyle, setSelectedStyle] = useState<InvestorStyleKey>(initialStyle);
  const [showTag, setShowTag] = useState(false);
  const [showRisk, setShowRisk] = useState(false);
  const [showCta, setShowCta] = useState(false);
  const [showOverride, setShowOverride] = useState(false);
  const [emojiOpacity, setEmojiOpacity] = useState(1);
  const [descVisible, setDescVisible] = useState(false);

  // Override toast
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

  // ── Word highlight callback ──────────────────────────────
  const handleWordHighlightComplete = () => {
    console.log('[StyleReveal] onComplete — showing risk badge');
    setShowRisk(true);
    setTimeout(() => setShowOverride(true), 300);
  };

  // ── Highlight token (only bumps when descVisible is true) ─
  const [highlightToken, setHighlightToken] = useState(0);

  useEffect(() => {
    if (descVisible) {
      console.log('[StyleReveal] descVisible=true, bumping highlightToken');
      setHighlightToken((t) => t + 1);
    }
  }, [descVisible, description]);

  const {
    words,
    activeIndex: activeWordIndex,
    completedIndices,
    isComplete: wordsComplete,
    skip: skipWords,
  } = useWordHighlight(description, 200, highlightToken, handleWordHighlightComplete);

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

  // ── Line 2 done → stagger reveals ──────────────────────
  useEffect(() => {
    if (!l2Done) return;
    console.log('[StyleReveal] typewriter done — staggering reveals');
    const t1 = setTimeout(() => setShowTag(true), 200);
    const t2 = setTimeout(() => {
      console.log('[StyleReveal] setting descVisible=true');
      setDescVisible(true);
    }, 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [l2Done]);

  // ── Words complete → show CTA ───────────────────────────
  useEffect(() => {
    if (!wordsComplete) return;
    const t = setTimeout(() => setShowCta(true), 400);
    return () => clearTimeout(t);
  }, [wordsComplete]);

  // ── Override handler ────────────────────────────────────
  const handleOverride = (style: InvestorStyleKey) => {
    if (style === selectedStyle) return;
    console.log('[StyleReveal] override:', style);
    setEmojiOpacity(0);
    setShowTag(false);
    setDescVisible(false);
    setShowRisk(false);
    setShowOverride(false);

    setTimeout(() => {
      setSelectedStyle(style);
      setEmojiOpacity(1);

      const label = getStyleContent(style).shortLabel;
      setToastText(`Updated to ${label}`);
      setToastVisible(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setToastVisible(false);
        setTimeout(() => setToastText(null), 200);
      }, 1500);

      setTimeout(() => {
        setShowTag(true);
        setTimeout(() => setDescVisible(true), 300);
      }, 150);
    }, 150);
  };

  // ── Tap-to-skip ─────────────────────────────────────────
  const handleScreenTap = () => {
    if (descVisible && !wordsComplete) {
      console.log('[StyleReveal] screen tap — skipping word highlight');
      skipWords();
    }
  };

  // ── RENDER ──────────────────────────────────────────────

  return (
    <div
      className="style-reveal-root bg-onboarding-reveal"
      onClick={handleScreenTap}
    >
      {/* ═══ TOP BAR ═══ */}
      <div className="style-reveal-topbar">
        {onBack && (
          <button
            onClick={onBack}
            style={{
              position: 'absolute',
              left: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              color: 'var(--text-secondary)',
              fontFamily: 'var(--font-sans)',
              fontSize: '15px',
            }}
          >
            <ChevronLeft size={20} />
            Back
          </button>
        )}
        <VantageOrb size={36} animate={false} showEntrance={false} />
      </div>

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <div className="style-reveal-content">
        {/* ── Emoji + glow ── */}
        <div className="style-reveal-emoji-wrap">
          <div
            className="style-reveal-glow"
            style={{
              background: glowBg,
              boxShadow: glowShadow,
              transition: 'background 300ms var(--ease-out), box-shadow 300ms var(--ease-out)',
            }}
          />
          <span
            className="style-reveal-emoji"
            style={{
              opacity: emojiOpacity,
              transition: 'opacity 150ms var(--ease-out)',
            }}
          >
            {emoji}
          </span>
        </div>

        {/* ── Headline ── */}
        <p className="style-reveal-line1">{line1Text}</p>
        <p className="style-reveal-line2">{line2Text}</p>

        {/* ── Tag pill ── */}
        <div
          className="style-reveal-tag"
          style={{ opacity: showTag ? 1 : 0 }}
        >
          {tag}
        </div>

        {/* ── Description (word highlight) ── */}
        <p
          className="style-reveal-description"
          style={{ opacity: descVisible ? 1 : 0 }}
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

        {/* ── Risk badge — IN NORMAL FLOW ── */}
        <div
          className="style-reveal-risk"
          style={{
            borderColor: riskColor,
            color: riskColor,
            opacity: showRisk ? 1 : 0,
          }}
        >
          {riskLabel} RISK
        </div>

        {/* ── Narrator ── */}
        <p
          className="style-reveal-narrator"
          style={{ opacity: showOverride ? 1 : 0 }}
        >
          Your investing style shapes everything in Vantage — your AI advisor, your strategy ideas, your risk settings.
        </p>

        {/* ── Override label + pills ── */}
        <div
          style={{
            opacity: showOverride ? 1 : 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
            marginBottom: '20px',
          }}
        >
          <p className="style-reveal-override-label">Not quite right?</p>

          <div className="style-reveal-pills">
            {ALL_STYLES.map((s) => {
              const isActive = s.id === selectedStyle;
              return (
                <button
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOverride(s.id);
                  }}
                  className="style-reveal-pill"
                  style={{
                    borderColor: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.15)',
                    background: isActive ? 'rgba(34,211,238,0.10)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'rgba(255,255,255,0.45)',
                  }}
                >
                  {s.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Toast ── */}
        {toastText && (
          <div
            className="style-reveal-toast"
            style={{ opacity: toastVisible ? 1 : 0 }}
          >
            {toastText}
          </div>
        )}

        {/* ── CTA ── */}
        <button
          className="style-reveal-cta"
          disabled={!showCta}
          onClick={() =>
            onCreateAccount({
              style: selectedStyle,
              risk: initialRisk,
              firstName,
              lastName,
            })
          }
          style={{
            background: showCta ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: showCta ? '#000000' : 'rgba(0,0,0,0.40)',
            opacity: showCta ? 1 : 0,
            pointerEvents: showCta ? 'auto' : 'none',
          }}
        >
          Create your account
        </button>
      </div>
    </div>
  );
}
