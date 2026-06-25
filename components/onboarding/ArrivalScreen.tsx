// ─── ArrivalScreen ──────────────────────────────────────────
// Full rebuild: async cycling sequence, new full-height layout,
// constellation top bar, big headline, white pill CTA bottom.
//
// Layout:
//   TOP BAR:    VantageMark 36px (left) + "I have an account ›" (right)
//   CONTENT:    flex column, space-between
//     TOP:      "Every investor has / a style." (52px, fades in)
//     MIDDLE:   cycling lines (22px, 64px fixed height)
//     BOTTOM:   white pill "Find my style" + subtext

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';

const LINES = [
  'Buffett waits decades.',
  'Livermore reads the tape.',
  'Soros bets against the world.',
];
const CLOSING_LINE = "Let's find yours.";
const CHAR_MS = 28;
const HOLD_MS = 600;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ArrivalScreenProps {
  onFindStyle: () => void;
  onSignIn: () => void;
}

export function ArrivalScreen({ onFindStyle, onSignIn }: ArrivalScreenProps) {
  const [headlineVisible, setHeadlineVisible] = useState(false);
  const [currentLine, setCurrentLine] = useState('');
  const [fading, setFading] = useState(false);
  const [showClosing, setShowClosing] = useState(false);
  const [showCta, setShowCta] = useState(false);
  const runningRef = useRef(false);

  // Headline fades in on mount
  useEffect(() => {
    const t = setTimeout(() => setHeadlineVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  // Async cycling sequence — runs once on mount
  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    let cancelled = false;

    async function runSequence() {
      // Small delay after headline fades in
      await sleep(800);

      // Type each support line
      for (const line of LINES) {
        if (cancelled) return;

        // Type character by character
        for (let i = 0; i <= line.length; i++) {
          if (cancelled) return;
          setCurrentLine(line.slice(0, i));
          await sleep(CHAR_MS);
        }

        // Hold the full line
        await sleep(HOLD_MS);

        // Fade out
        if (cancelled) return;
        setFading(true);
        await sleep(200);
        setCurrentLine('');
        setFading(false);
        await sleep(100);
      }

      // Show closing line
      if (!cancelled) {
        setShowClosing(true);
        await sleep(400);
        setShowCta(true);
      }
    }

    runSequence();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleFindStyle = useCallback(() => {
    if (!showCta) return;
    onFindStyle();
  }, [showCta, onFindStyle]);

  return (
    <div
      className="bg-onboarding-0"
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── TOP BAR: 60px ── */}
      <div
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Constellation mark */}
        <VantageOrb size={44} animate showEntrance={false} />

        {/* Sign-in link */}
        <button
          onClick={onSignIn}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.55)',
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'var(--font-sans)',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            padding: '8px 0 8px 8px',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          I have an account
          <ChevronRight size={13} />
        </button>
      </div>

      {/* ── CONTENT: flex column, space-between ── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '0 28px',
          paddingBottom: 'max(48px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* ── TOP: Headline ── */}
        <h1
          style={{
            marginTop: '32px',
            opacity: headlineVisible ? 1 : 0,
            transform: headlineVisible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 400ms ease-out, transform 400ms ease-out',
          }}
        >
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-sans)',
              fontSize: '52px',
              fontWeight: 800,
              color: '#ffffff',
              lineHeight: 1.05,
            }}
          >
            Every investor has
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '52px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#ffffff',
              lineHeight: 1.05,
            }}
          >
            a style.
          </span>
        </h1>

        {/* ── MIDDLE: Cycling lines (64px fixed height) ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {!showClosing ? (
            <div style={{ height: '64px', display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '22px',
                  fontWeight: 500,
                  color: 'rgba(255,255,255,0.72)',
                  fontFamily: 'var(--font-sans)',
                  opacity: fading ? 0 : 1,
                  transition: 'opacity 200ms ease',
                }}
              >
                {currentLine}
              </span>
            </div>
          ) : (
            <div style={{ height: '64px', display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '28px',
                  fontWeight: 800,
                  fontFamily: 'var(--font-sans)',
                  color: '#ffffff',
                  opacity: showClosing ? 1 : 0,
                  transition: 'opacity 300ms ease-out',
                }}
              >
                {CLOSING_LINE}
              </span>
            </div>
          )}
        </div>

        {/* ── BOTTOM: CTA + subtext ── */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <button
            onClick={handleFindStyle}
            style={{
              width: '100%',
              height: '58px',
              borderRadius: '999px',
              border: 'none',
              background: '#ffffff',
              color: '#000000',
              fontSize: '17px',
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              cursor: showCta ? 'pointer' : 'default',
              opacity: showCta ? 1 : 0,
              transform: showCta ? 'translateY(0)' : 'translateY(12px)',
              pointerEvents: showCta ? 'auto' : 'none',
              transition: 'opacity 400ms ease-out, transform 400ms ease-out',
            }}
          >
            Find my style
          </button>

          <p
            style={{
              marginTop: '12px',
              fontSize: '13px',
              color: 'rgba(255,255,255,0.35)',
              textAlign: 'center',
              opacity: showCta ? 1 : 0,
              transition: 'opacity 400ms ease-out',
            }}
          >
            Takes 2 minutes. No account needed to take the quiz.
          </p>
        </div>
      </div>
    </div>
  );
}
