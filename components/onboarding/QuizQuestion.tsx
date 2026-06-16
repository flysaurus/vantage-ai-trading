// ─── QuizQuestion ──────────────────────────────────────────
// Renders a single quiz question with answer cards.
// Slide transitions between questions (320ms, ease-in-out).
//
// Layout:
// - Progress bar (top, 3px, cyan fill, smooth 400ms)
// - Question label (11px, muted, uppercase, letter-spacing)
// - Question text (24px, white, semibold)
// - Answer cards (full-width, stacked, 10px gap)
// - Tap state: cyan border + bg, scale 0.98, auto-advance 280ms

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
    // Trigger slide-in
    const t = setTimeout(() => setVisible(true), 16);
    return () => {
      mountedRef.current = false;
      clearTimeout(t);
    };
  }, [question.id]);

  const handleSelect = (key: string) => {
    if (selected) return;
    setSelected(key);
    // Show tap state, then auto-advance
    setTimeout(() => {
      if (mountedRef.current) {
        onAnswer(key);
      }
    }, 280);
  };

  const progress = (questionNumber / totalQuestions) * 100;

  return (
    <div
      style={{
        width: '100%',
        padding: '0 20px',
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
          marginBottom: '32px',
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
                padding: '16px',
                background: isSelected ? 'rgba(34, 211, 238, 0.08)' : '#1a2235',
                border: isSelected
                  ? '1px solid #22d3ee'
                  : '1px solid rgba(255,255,255,0.06)',
                borderRadius: '14px',
                cursor: selected ? 'default' : 'pointer',
                opacity: isDimmed ? 0.4 : 1,
                transform: isSelected ? 'scale(0.98)' : 'scale(1)',
                transition: 'all 150ms ease',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
              }}
            >
              {/* Letter badge */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: isSelected ? '#22d3ee' : 'rgba(34, 211, 238, 0.15)',
                  color: isSelected ? '#0a0f1e' : '#22d3ee',
                  fontSize: '13px',
                  fontWeight: 600,
                  flexShrink: 0,
                  marginTop: '1px',
                  transition: 'all 150ms ease',
                }}
              >
                {option.key}
              </span>

              {/* Answer text */}
              <span
                style={{
                  fontSize: '15px',
                  color: isSelected ? '#ffffff' : '#94a3b8',
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
