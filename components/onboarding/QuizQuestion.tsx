// ─── QuizQuestion ───────────────────────────────────────────
// Stacked answer cards with A/B/C/D letter labels, white pill
// Continue, two-line headline system. No narrator. VantageOrb
// in top bar instead of constellation.
//
// Layout (full-height flex column):
//   TOP BAR:    56px — Back (left) + VantageOrb 44px (center)
//   PROGRESS:   5-segment bar, 3px tall
//   QUESTION:   label + two-line headline (sans+serif)
//   CARDS:      full-width vertical stack, single-select
//   CONTINUE:   white pill, disabled until selection

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';

// ── Two-line question splits ──────────────────────────────

const QUESTION_LINES: Record<string, [string, string]> = {
  q1: ['You spot a promising', 'company nobody talks about yet.'],
  q2: ['You made a conviction bet.', 'Early signs say you\'re wrong.'],
  q3: ['Five great ideas,', 'limited capital. Where does it go?'],
  q4: ['When it\'s time to decide,', 'what moves the needle?'],
  q5: ['Are you usually a', 'risk-taker with money?'],
};

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E'];

interface QuizQuestionProps {
  question: QuizQuestionType;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (key: string) => void;
  onBack?: () => void;
  onSignIn?: () => void;
}

export function QuizQuestion({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onBack,
  onSignIn,
}: QuizQuestionProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(true);
  const [showScrollFade, setShowScrollFade] = useState(false);
  const mountRef = useRef(false);
  const lastCardRef = useRef<HTMLButtonElement | null>(null);
  const cardsContainerRef = useRef<HTMLDivElement | null>(null);

  // Entrance animation
  useEffect(() => {
    if (mountRef.current) {
      setEntering(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntering(true));
      });
    } else {
      mountRef.current = true;
      requestAnimationFrame(() => setEntering(true));
    }
  }, []);

  // ── Scroll fade: show gradient when last card is below viewport ─
  useEffect(() => {
    const container = cardsContainerRef.current;
    const sentinel = lastCardRef.current;
    if (!container || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowScrollFade(!entry.isIntersecting);
      },
      { root: container, threshold: 0.1 },
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [question.id]);

  const gradientClass = `bg-onboarding-${questionNumber}`;
  const [line1, line2] = QUESTION_LINES[question.id] || [question.question, ''];
  const isFirst = questionNumber === 1;
  const isLastQ = questionNumber === totalQuestions;

  const handleTap = useCallback((key: string) => {
    if (leaving) return;
    setSelectedKey(key);
  }, [leaving]);

  const handleContinue = useCallback(() => {
    if (!selectedKey || leaving) return;
    setLeaving(true);
    setTimeout(() => onAnswer(selectedKey), 250);
  }, [selectedKey, leaving, onAnswer]);

  const handleBack = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => onBack?.(), 250);
  }, [leaving, onBack]);

  return (
    <div
      className={gradientClass}
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        transition: 'transform 250ms ease-in, opacity 250ms ease-in',
        transform: leaving
          ? 'translateX(-100%)'
          : entering
            ? 'translateX(0)'
            : 'translateX(100%)',
        opacity: leaving ? 0 : entering ? 1 : 0,
      }}
    >
      {/* ── TOP BAR ── */}
      <div
        style={{
          height: '56px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          position: 'relative',
          flexShrink: 0,
          paddingTop: 'env(safe-area-inset-top, 0px)',
        }}
      >
        {/* Left: Back button (all questions) */}
        {onBack && (
          <button
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.70)',
              fontSize: '14px',
              fontWeight: 400,
              cursor: 'pointer',
              padding: '8px 12px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'var(--font-sans)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <ChevronLeft size={20} />
            Back
          </button>
        )}

        {/* Center: VantageOrb (small pulsing sphere) */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <VantageOrb size={44} animate showEntrance={false} />
        </div>


      </div>

      {/* ── PROGRESS LABELS ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '0 20px',
          flexShrink: 0,
          marginBottom: '6px',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.50)',
            flex: 1,
          }}
        >
          INVESTOR STYLE
        </span>
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 400,
            color: 'rgba(34,211,238,0.70)',
            textAlign: 'right',
            minWidth: '40px',
          }}
        >
          RISK
        </span>
      </div>

      {/* ── PROGRESS BAR ── */}
      <div
        style={{
          display: 'flex',
          gap: '2px',
          padding: '0',
          flexShrink: 0,
          height: '3px',
        }}
      >
        {Array.from({ length: totalQuestions }).map((_, i) => {
          const isFilled = i < questionNumber;
          const isLast = i === totalQuestions - 1;
          return (
            <div
              key={i}
              style={{
                flex: 1,
                height: '3px',
                borderRadius: '1px',
                background: isFilled
                  ? isLast
                    ? 'var(--accent)'
                    : 'rgba(255,255,255,0.60)'
                  : isLast
                    ? 'rgba(34,211,238,0.15)'
                    : 'rgba(255,255,255,0.15)',
                transition: 'background 300ms ease-out',
              }}
            />
          );
        })}
      </div>

      {/* ── QUESTION AREA ── */}
      <div
        style={{
          padding: '32px 24px 0',
          flexShrink: 0,
        }}
      >
        <p
          style={{
            fontSize: '11px',
            color: isLastQ
              ? 'var(--accent)'
              : 'rgba(34,211,238,0.7)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '12px',
            fontWeight: 500,
          }}
        >
          {isLastQ
            ? `YOUR RISK PROFILE · ${questionNumber} OF ${totalQuestions}`
            : `${question.label} · ${questionNumber} OF ${totalQuestions}`}
        </p>

        {/* Two-line headline */}
        <h2 style={{ margin: 0 }}>
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
            {line1}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: 'var(--font-serif)',
              fontSize: '38px',
              fontWeight: 400,
              fontStyle: 'italic',
              color: 'var(--text-primary)',
              lineHeight: 1.1,
            }}
          >
            {line2}
          </span>
        </h2>

        {/* Answer count label */}
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '11px',
            fontWeight: 400,
            color: 'rgba(255,255,255,0.40)',
            margin: '12px 0 0',
          }}
        >
          Choose one · {question.options.length} options
        </p>
      </div>

      {/* ── ANSWER CARDS ── */}
      <div
        ref={cardsContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          minHeight: 0,
          scrollbarWidth: 'none',
          position: 'relative',
        }}
        className="hide-scrollbar"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {question.options.map((opt, idx) => {
            const isSelected = selectedKey === opt.key;
            const hasSelection = selectedKey !== null;
            const label = OPTION_LABELS[idx] || '';
            const isLastOption = idx === question.options.length - 1;

            return (
              <button
                key={opt.key}
                ref={isLastOption ? lastCardRef : undefined}
                onClick={() => handleTap(opt.key)}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 0,
                  padding: '18px 20px',
                  background: isSelected
                    ? 'rgba(34,211,238,0.08)'
                    : hasSelection
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(255,255,255,0.05)',
                  border: isSelected
                    ? '1px solid var(--accent)'
                    : hasSelection
                      ? '1px solid rgba(255,255,255,0.05)'
                      : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '18px',
                  cursor: 'pointer',
                  transition: 'all 150ms var(--ease-out)',
                  opacity: hasSelection && !isSelected ? 0.6 : 1,
                  WebkitTapHighlightColor: 'transparent',
                }}
                onTouchStart={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                }}
                onTouchEnd={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }}
              >
                {/* Letter label badge */}
                <span
                  style={{
                    flexShrink: 0,
                    width: '28px',
                    height: '28px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: isSelected
                      ? 'var(--accent)'
                      : 'rgba(255,255,255,0.35)',
                    background: isSelected
                      ? 'rgba(34,211,238,0.15)'
                      : 'rgba(255,255,255,0.06)',
                    border: isSelected
                      ? '1px solid rgba(34,211,238,0.40)'
                      : '1px solid transparent',
                    transition: 'all 150ms var(--ease-out)',
                  }}
                >
                  {label}
                </span>

                {/* Answer text */}
                <span
                  style={{
                    flex: 1,
                    paddingLeft: '14px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '17px',
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: isSelected
                      ? 'var(--text-primary)'
                      : hasSelection
                        ? 'var(--text-secondary)'
                        : 'var(--text-primary)',
                    textAlign: 'left' as const,
                  }}
                >
                  {opt.text}
                </span>
              </button>
            );
          })}
        </div>

        {/* Scroll fade indicator */}
        {showScrollFade && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '80px',
              background:
                'linear-gradient(to bottom, transparent 60%, var(--bg) 100%)',
              pointerEvents: 'none',
            }}
          />
        )}
      </div>

      {/* ── CONTINUE BUTTON ── */}
      <div style={{ flexShrink: 0, padding: '0 24px' }}>
        <button
          onClick={handleContinue}
          disabled={!selectedKey}
          style={{
            width: '100%',
            height: '56px',
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: selectedKey ? '#ffffff' : 'rgba(255,255,255,0.20)',
            color: selectedKey ? '#000000' : 'rgba(0,0,0,0.40)',
            fontSize: '17px',
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            cursor: selectedKey ? 'pointer' : 'default',
            pointerEvents: selectedKey ? 'auto' : 'none',
            marginTop: '16px',
            transition: 'background 200ms var(--ease-out), color 200ms var(--ease-out)',
          }}
        >
          Continue
        </button>
      </div>

      {/* ── "I ALREADY HAVE AN ACCOUNT" LINK ── */}
      {onSignIn && (
        <div
          style={{
            flexShrink: 0,
            paddingBottom: 'max(32px, env(safe-area-inset-bottom, 0px))',
            textAlign: 'center',
          }}
        >
          <button
            onClick={onSignIn}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.50)',
              fontSize: '14px',
              fontWeight: 400,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              padding: '12px 0',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            I already have an account
          </button>
        </div>
      )}
    </div>
  );
}
