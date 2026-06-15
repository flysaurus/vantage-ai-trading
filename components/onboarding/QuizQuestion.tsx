// ─── QuizQuestion ──────────────────────────────────────────
// Renders a single quiz question with answer cards.
// Slide transitions between questions with direction state.
//
// Layout:
// - Progress bar (top, 4px, cyan fill)
// - Question number ("2 of 5", muted)
// - Question text (large, white)
// - Answer cards (full-width, stacked, #1a2235 bg)
// - Cyan border on hover/tap
// - Selected state → 300ms delay → advance

'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { QuizQuestion as QuizQuestionType } from '@/lib/onboarding/quiz-logic';

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
  const [selected, setSelected] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setSelected(null);
    // Trigger slide-in after a tick (for CSS transition)
    const t = setTimeout(() => setVisible(true), 16);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
    };
  }, [question.id]);

  const handleSelect = (key: string) => {
    if (selected) return; // Already selected — prevent double-tap
    setSelected(key);

    // Brief delay to show selected state, then advance
    setTimeout(() => {
      if (mountedRef.current) {
        onAnswer(key);
      }
    }, 350);
  };

  const progress = (questionNumber / totalQuestions) * 100;

  const isRiskQuestion = question.id === 'q5';

  return (
    <div
      style={{
        padding: '0 20px',
        transform: visible
          ? 'translateX(0)'
          : direction === 'forward'
            ? 'translateX(40px)'
            : 'translateX(-40px)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s ease, opacity 0.3s ease',
      }}
    >
      {/* Progress bar */}
      <div
        style={{
          width: '100%',
          height: '4px',
          background: '#1f2937',
          borderRadius: '2px',
          overflow: 'hidden',
          marginBottom: '32px',
          marginTop: '24px',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: '#22d3ee',
            borderRadius: '2px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Question number */}
      <p
        style={{
          fontSize: '13px',
          color: '#64748b',
          fontWeight: 500,
          marginBottom: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {isRiskQuestion ? 'Risk Profile' : `Question ${questionNumber} of ${totalQuestions - 1}`}
      </p>

      {/* Question text */}
      <h2
        style={{
          fontSize: '22px',
          fontWeight: 600,
          color: '#ffffff',
          lineHeight: 1.4,
          marginBottom: '28px',
        }}
      >
        {question.question}
      </h2>

      {/* Answer cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {question.options.map((option) => {
          const isSelected = selected === option.key;
          const isDimmed = selected && selected !== option.key;

          return (
            <button
              key={option.key}
              onClick={() => handleSelect(option.key)}
              disabled={!!selected}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '16px 18px',
                background: isSelected ? 'rgba(34, 211, 238, 0.10)' : '#1a2235',
                border: isSelected
                  ? '1px solid #22d3ee'
                  : '1px solid #1e293b',
                borderRadius: '14px',
                cursor: selected ? 'default' : 'pointer',
                opacity: isDimmed ? 0.4 : 1,
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              {/* Option letter badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  background: isSelected ? '#22d3ee' : 'rgba(34, 211, 238, 0.12)',
                  color: isSelected ? '#0a0f1e' : '#22d3ee',
                  fontSize: '13px',
                  fontWeight: 700,
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'all 0.2s ease',
                }}
              >
                {option.key}
              </span>

              {/* Option text */}
              <span
                style={{
                  fontSize: '14px',
                  color: isSelected ? '#ffffff' : '#cbd5e1',
                  lineHeight: 1.5,
                  fontWeight: isSelected ? 500 : 400,
                }}
              >
                {option.text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
