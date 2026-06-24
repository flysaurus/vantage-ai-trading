// ─── QuizQuestion ──────────────────────────────────────────
// Renders a single quiz question with horizontal swipeable
// answer carousel. Uses ScreenTransition for slide animations.
//
// Three-zone flex layout (full viewport):
//   TOP: progress bar + question label + question text
//   MIDDLE: AnswerCarousel (existing, keep)
//   BOTTOM: swipe hint → CarouselDots → back button

'use client';

import React, { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';
import { AnswerCarousel } from './AnswerCarousel';
import { CarouselDots } from './CarouselDots';
import ScreenTransition from '@/components/layout/ScreenTransition';

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
  const [carouselActiveIndex, setCarouselActiveIndex] = useState(0);
  const [showSwipeHint, setShowSwipeHint] = useState(questionNumber === 1);
  const [hintFading, setHintFading] = useState(false);

  // Swipe hint — fades when user first scrolls
  useEffect(() => {
    if (!showSwipeHint || hintFading) return;
    if (carouselActiveIndex !== 0) {
      setHintFading(true);
    }
  }, [carouselActiveIndex, showSwipeHint, hintFading]);

  const progress = (questionNumber / totalQuestions) * 100;
  const isFirst = questionNumber === 1;

  return (
    <ScreenTransition
      direction={questionNumber > 1 ? 'forward' : 'fade'}
      transitionKey={question.id}
    >
      <div
        style={{
          width: '100%',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          padding: '24px',
        }}
      >
        {/* TOP: progress + label + question */}
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
              background: 'var(--border-subtle)',
              borderRadius: '2px',
              overflow: 'hidden',
              marginBottom: 'var(--space-3)',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progress}%`,
                background: 'var(--accent)',
                borderRadius: '2px',
                transition: 'width 400ms var(--ease-out)',
              }}
            />
          </div>

          {/* Label */}
          <p
            style={{
              fontSize: '12px',
              color: 'rgba(34,211,238,0.7)',
              fontWeight: 500,
              marginBottom: 'var(--space-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
            }}
          >
            {question.label} · {questionNumber} OF {totalQuestions}
          </p>

          {/* Question text */}
          <h2
            style={{
              fontSize: 'var(--onb-headline, 30px)',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.35,
              marginBottom: 'var(--space-6)',
            }}
          >
            {question.question}
          </h2>
        </div>

        {/* MIDDLE: carousel */}
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
            isFirstQuestion={isFirst}
            hideFooter
            onActiveIndexChange={setCarouselActiveIndex}
          />
        </div>

        {/* BOTTOM: swipe hint → dots → back */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'var(--space-2)',
            paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))',
          }}
        >
          {/* Swipe hint (Q1 only, fades on first scroll) */}
          {showSwipeHint && (
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-muted)',
                textAlign: 'center',
                margin: 0,
                opacity: hintFading ? 0 : 1,
                transition: 'opacity 400ms var(--ease-out)',
              }}
            >
              ← swipe to browse →
            </p>
          )}

          {/* Dots */}
          <CarouselDots total={question.options.length} activeIndex={carouselActiveIndex} />

          {/* Back button (Q2-Q5 only) */}
          <div style={{ width: '100%', display: 'flex', marginTop: 'var(--space-2)' }}>
            {!isFirst && onBack && (
              <button
                onClick={onBack}
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
                <ChevronLeft size={16} />
                Back
              </button>
            )}
          </div>
        </div>
      </div>
    </ScreenTransition>
  );
}
