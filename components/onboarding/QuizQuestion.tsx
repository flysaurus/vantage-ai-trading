// ─── QuizQuestion ──────────────────────────────────────────
// Renders a single quiz question with horizontal swipeable
// answer carousel (Tinder/App Store style).
//
// Three-zone flex layout (full viewport):
//   TOP zone: progress bar + question label + question text
//     (static, not flex-centered — anchored near top)
//   MIDDLE zone: flex:1, centered — AnswerCarousel scroll area
//   BOTTOM zone: swipe hint (Q1 only) → dots → back button
//     anchored near bottom (24px padding)
//
// Slide transition between questions: 320ms ease-in-out

'use client';

import React, { useState, useEffect } from 'react';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';
import { AnswerCarousel } from './AnswerCarousel';
import { CarouselDots } from './CarouselDots';

interface QuizQuestionProps {
  question: QuizQuestionType;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (key: string) => void;
  onBack?: () => void;
  direction: 'forward' | 'backward';
}

export function QuizQuestion({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  onBack,
  direction,
}: QuizQuestionProps) {
  const [visible, setVisible] = useState(false);
  const [carouselActiveIndex, setCarouselActiveIndex] = useState(0);

  // ── Swipe hint logic ──────────────────────────────────────
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [hintFading, setHintFading] = useState(false);

  useEffect(() => {
    if (questionNumber !== 1) return;
    const alreadyShown =
      typeof window !== 'undefined' &&
      sessionStorage.getItem('vantage_swipe_hint_shown') === 'true';
    if (!alreadyShown) {
      setShowSwipeHint(true);
    }
  }, [questionNumber]);

  useEffect(() => {
    if (!showSwipeHint || hintFading) return;
    if (carouselActiveIndex !== 0) {
      setHintFading(true);
      const t = setTimeout(() => {
        setShowSwipeHint(false);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('vantage_swipe_hint_shown', 'true');
        }
      }, 400);
      return () => clearTimeout(t);
    }
  }, [carouselActiveIndex, showSwipeHint, hintFading]);

  // ── Slide-in trigger ──────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(t);
  }, [question.id]);

  const progress = (questionNumber / totalQuestions) * 100;
  const isFirstQuestion = questionNumber === 1;

  return (
    <div
      style={{
        width: '100%',
        height: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px 24px 24px 24px',
        transform: visible
          ? 'translateX(0)'
          : direction === 'forward'
            ? 'translateX(100%)'
            : 'translateX(-100%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 320ms ease-in-out, opacity 320ms ease-in-out',
      }}
    >
      {/* ── TOP zone: progress + label + question ──────────── */}
      <div
        style={{
          flexShrink: 0,
          paddingTop: 'max(8px, env(safe-area-inset-top, 0px))',
        }}
      >
        {/* Progress bar */}
        <div
          style={{
            width: '100%',
            height: '3px',
            background: 'rgba(255,255,255,0.08)',
            borderRadius: '2px',
            overflow: 'hidden',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progress}%`,
              background: '#22d3ee',
              borderRadius: '2px',
              transition: 'width 400ms ease',
            }}
          />
        </div>

        {/* Question label + counter */}
        <p
          style={{
            fontSize: '11px',
            color: 'rgba(34,211,238,0.7)',
            fontWeight: 500,
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
          }}
        >
          {question.label} · {questionNumber} OF {totalQuestions}
        </p>

        {/* Question text */}
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 600,
            color: '#ffffff',
            lineHeight: 1.35,
            marginBottom: '24px',
          }}
        >
          {question.question}
        </h2>
      </div>

      {/* ── MIDDLE zone: carousel, centered ────────────────── */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
          width: '100%',
          minWidth: 0,
        }}
      >
        <AnswerCarousel
          key={question.id}
          answers={question.options}
          onSelect={onAnswer}
          isFirstQuestion={isFirstQuestion}
          hideFooter
          onActiveIndexChange={setCarouselActiveIndex}
        />
      </div>

      {/* ── BOTTOM zone: swipe hint → dots → back ──────────── */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          paddingBottom: 'max(0px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {/* Swipe hint (Q1 only) */}
        {showSwipeHint && (
          <p
            style={{
              fontSize: '13px',
              color: '#64748b',
              textAlign: 'center',
              margin: 0,
              opacity: hintFading ? 0 : 1,
              transition: 'opacity 400ms ease',
            }}
          >
            ← swipe to browse →
          </p>
        )}

        {/* Dots */}
        <CarouselDots
          total={question.options.length}
          activeIndex={carouselActiveIndex}
        />

        {/* Back button (Q2-Q5 only, left-aligned within bottom zone) */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            marginTop: '8px',
          }}
        >
          {!isFirstQuestion && onBack && (
            <button
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: 'rgba(255,255,255,0.7)',
                fontSize: '15px',
                cursor: 'pointer',
                padding: '8px 12px',
                minHeight: '44px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                WebkitTapHighlightColor: 'transparent',
                transition: 'opacity 150ms ease',
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.opacity = '0.6';
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
