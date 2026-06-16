// ─── QuizQuestion ──────────────────────────────────────────
// Renders a single quiz question with horizontal swipeable
// answer carousel (Tinder/App Store style).
//
// Layout:
// - Progress bar (top, 3px, cyan fill, smooth 400ms)
// - Question label (11px, muted, uppercase, letter-spacing)
// - Question text (24px, white, semibold)
// - AnswerCarousel (horizontal snap, one card centered at a time)
// - Slide transition between questions: 320ms ease-in-out

'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';
import { AnswerCarousel } from './AnswerCarousel';

interface QuizQuestionProps {
  question: QuizQuestionType;
  questionNumber: number;
  totalQuestions: number;
  onAnswer: (key: string) => void;
  direction: 'forward' | 'backward';
}

export function QuizQuestion({
  question,
  questionNumber,
  totalQuestions,
  onAnswer,
  direction,
}: QuizQuestionProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger slide-in
    const t = setTimeout(() => setVisible(true), 16);
    return () => clearTimeout(t);
  }, [question.id]);

  const progress = (questionNumber / totalQuestions) * 100;

  return (
    <div
      style={{
        width: '100%',
        transform: visible
          ? 'translateX(0)'
          : direction === 'forward'
            ? 'translateX(100%)'
            : 'translateX(-100%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 320ms ease-in-out, opacity 320ms ease-in-out',
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
          marginTop: '0',
          padding: '0 20px',
          boxSizing: 'border-box',
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

      {/* Question label */}
      <p
        style={{
          fontSize: '11px',
          color: 'rgba(34,211,238,0.7)',
          fontWeight: 500,
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          paddingLeft: '20px',
        }}
      >
        {question.label}
      </p>

      {/* Question text */}
      <h2
        style={{
          fontSize: '24px',
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.35,
          marginBottom: '24px',
          paddingLeft: '20px',
          paddingRight: '20px',
        }}
      >
        {question.question}
      </h2>

      {/* Answer carousel */}
      <AnswerCarousel
        key={question.id}
        answers={question.options}
        onSelect={onAnswer}
        isFirstQuestion={questionNumber === 1}
      />
    </div>
  );
}
