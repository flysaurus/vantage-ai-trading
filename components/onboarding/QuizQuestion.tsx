// ─── QuizQuestion ───────────────────────────────────────────
// Full redesign: stacked answer cards, white pill Continue,
// two-line headline system, gradient backgrounds, slide
// transitions. No carousel — cards are a vertical stack.
//
// Layout (full-height flex column):
//   TOP BAR:    56px — Back (left) + VantageMark (center)
//   PROGRESS:   5-segment bar, 3px tall
//   QUESTION:   label + two-line headline (sans+serif)
//   CARDS:      full-width vertical stack, single-select
//   NARRATOR:   Vantage brand line + context text
//   CONTINUE:   white pill, disabled until selection

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft } from 'lucide-react';
import { VantageMark } from '@/components/brand/VantageMark';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';

// ── Two-line question splits ──────────────────────────────

const QUESTION_LINES: Record<string, [string, string]> = {
  q1: ['You spot a promising', 'company nobody talks about yet.'],
  q2: ['You made a conviction bet.', 'Early signs say you\'re wrong.'],
  q3: ['Five great ideas,', 'limited capital. Where does it go?'],
  q4: ['When it\'s time to decide,', 'what moves the needle?'],
  q5: ['Are you usually a', 'risk-taker with money?'],
};

const NARRATOR_LINES: Record<string, string> = {
  q1: "This tells us how you spot opportunity — before the crowd does.",
  q2: "How you handle being wrong separates great investors from the rest.",
  q3: "Allocation reveals conviction. Where you put the most says everything.",
  q4: "The information you trust most defines your edge.",
  q5: "Risk tolerance shapes every decision you'll ever make.",
};

interface QuizQuestionProps {
  question: QuizQuestionType;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (key: string) => void;
  onBack?: () => void;
}

export function QuizQuestion({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onBack,
}: QuizQuestionProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [entering, setEntering] = useState(true);
  const mountRef = useRef(false);

  // Entrance animation
  useEffect(() => {
    if (mountRef.current) {
      // Slide-in from right
      setEntering(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setEntering(true));
      });
    } else {
      mountRef.current = true;
      // First mount: no slide
      requestAnimationFrame(() => setEntering(true));
    }
  }, []);

  const gradientClass = `bg-onboarding-${questionNumber}`;
  const [line1, line2] = QUESTION_LINES[question.id] || [question.question, ''];
  const narrator = NARRATOR_LINES[question.id] || '';
  const isFirst = questionNumber === 1;

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
        {/* Left: Back button (Q2-Q5) */}
        {!isFirst && onBack && (
          <button
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: '15px',
              cursor: 'pointer',
              padding: '8px 12px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontFamily: 'inherit',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <ChevronLeft size={20} />
            Back
          </button>
        )}

        {/* Center: VantageMark */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <VantageMark size={36} />
        </div>
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
        {Array.from({ length: totalQuestions }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: '3px',
              borderRadius: '1px',
              background:
                i < questionNumber
                  ? 'var(--accent)'
                  : 'rgba(255,255,255,0.15)',
              transition: 'background 300ms ease-out',
            }}
          />
        ))}
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
            color: 'rgba(34,211,238,0.7)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: '12px',
            fontWeight: 500,
          }}
        >
          {question.label} · {questionNumber} OF {totalQuestions}
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
      </div>

      {/* ── ANSWER CARDS ── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px',
          minHeight: 0,
          scrollbarWidth: 'none',
        }}
        className="hide-scrollbar"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {question.options.map((opt) => {
            const isSelected = selectedKey === opt.key;
            const hasSelection = selectedKey !== null;

            return (
              <button
                key={opt.key}
                onClick={() => handleTap(opt.key)}
                style={{
                  width: '100%',
                  padding: '18px 20px',
                  background: isSelected
                    ? 'rgba(34,211,238,0.10)'
                    : hasSelection
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(255,255,255,0.06)',
                  border: isSelected
                    ? '1px solid var(--accent)'
                    : hasSelection
                      ? '1px solid rgba(255,255,255,0.05)'
                      : '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '18px',
                  textAlign: 'left' as const,
                  fontFamily: 'var(--font-sans)',
                  fontSize: '17px',
                  fontWeight: 500,
                  color: isSelected
                    ? 'var(--text-primary)'
                    : hasSelection
                      ? 'var(--text-secondary)'
                      : 'var(--text-primary)',
                  lineHeight: 1.4,
                  cursor: 'pointer',
                  transition: 'all 150ms var(--ease-out)',
                  opacity: hasSelection && !isSelected ? 0.6 : 1,
                  WebkitTapHighlightColor: 'transparent',
                  transform: 'scale(1)',
                }}
                onTouchStart={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)';
                }}
                onTouchEnd={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }}
              >
                {opt.text}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── NARRATOR + CONTINUE ── */}
      <div style={{ flexShrink: 0, padding: '0 24px' }}>
        {/* Narrator line */}
        {narrator && (
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: '4px',
              paddingTop: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, paddingTop: '1px' }}>
              <VantageMark size={16} />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                Vantage AI
              </span>
            </div>
          </div>
        )}
        {narrator && (
          <p
            style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              fontWeight: 400,
              lineHeight: 1.5,
              margin: '4px 0 0',
              paddingLeft: '24px',
            }}
          >
            {narrator}
          </p>
        )}

        {/* Continue button */}
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
            marginBottom: '32px',
            transition: 'background 200ms var(--ease-out), color 200ms var(--ease-out)',
          }}
          onTouchStart={(e) => {
            if (!selectedKey) return;
            (e.currentTarget as HTMLElement).style.transform = 'scale(0.97)';
          }}
          onTouchEnd={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
