// ─── AnswerCarousel ────────────────────────────────────────
// Horizontal swipeable carousel of answer cards.
// One card centered at a time with partial peeks at neighbors.
//
// Selection animation (FIX 2):
//   Tap centered card → DOM-level CSS animation (no React state)
//   → after 280ms → call onSelect → parent advances question
//
// Card design (FIX 3 — Alinea-style):
//   Large, round, frosted-glass feel, left-aligned text, generous
//   padding. Active card: glow border + subtle highlight bg.
//   Inactive: dimmed, scaled down, clearly de-focused.
//   No letter badges — dots + position communicate which is which.

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useCarouselScroll } from '@/hooks/useCarouselScroll';
import { CarouselDots } from './CarouselDots';

interface AnswerOption {
  key: string;
  text: string;
}

interface AnswerCarouselProps {
  answers: AnswerOption[];
  onSelect: (key: string) => void;
  isFirstQuestion: boolean;
  hideFooter?: boolean;
  onActiveIndexChange?: (index: number) => void;
}

export function AnswerCarousel({
  answers,
  onSelect,
  isFirstQuestion,
  hideFooter = false,
  onActiveIndexChange,
}: AnswerCarouselProps) {
  const { containerRef, registerCard, activeIndex, scrollToIndex } =
    useCarouselScroll({ cardCount: answers.length });

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const selectingRef = useRef(false);

  const [entranceKey, setEntranceKey] = useState(0);
  const [scrolledOnce, setScrolledOnce] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const swipeHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Bump entrance key when answers change (new question) → fresh keyframe
  useEffect(() => {
    setEntranceKey((k) => k + 1);
    // Reset card refs array when question changes
    cardRefs.current = [];
  }, [answers]);

  // Notify parent of active index changes
  useEffect(() => {
    onActiveIndexChange?.(activeIndex);
  }, [activeIndex, onActiveIndexChange]);

  // Swipe hint — show on first question only
  useEffect(() => {
    if (!isFirstQuestion || hideFooter) return;
    const alreadyShown =
      typeof window !== 'undefined' &&
      sessionStorage.getItem('vantage_swipe_hint_shown') === 'true';
    if (!alreadyShown) setShowSwipeHint(true);
  }, [isFirstQuestion, hideFooter]);

  useEffect(() => {
    if (!showSwipeHint || scrolledOnce) return;
    if (activeIndex !== 0) {
      setScrolledOnce(true);
      if (swipeHintTimer.current) clearTimeout(swipeHintTimer.current);
      swipeHintTimer.current = setTimeout(() => {
        setShowSwipeHint(false);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('vantage_swipe_hint_shown', 'true');
        }
      }, 400);
    }
  }, [activeIndex, showSwipeHint, scrolledOnce]);

  useEffect(() => {
    return () => {
      if (swipeHintTimer.current) clearTimeout(swipeHintTimer.current);
    };
  }, []);

  // ── Card tap: DOM animation first, state update last ──────

  const handleCardTap = useCallback(
    (index: number, answerKey: string) => {
      if (selectingRef.current) return;

      const card = cardRefs.current[index];
      if (!card) return;

      // Not the centered card — scroll it into center
      if (index !== activeIndex) {
        scrollToIndex(index);
        return;
      }

      // IS centered — animate selection entirely in DOM layer
      selectingRef.current = true;

      // Phase 1: scale up + glow border (150ms)
      card.style.transform = 'scale(1.04)';
      card.style.borderColor = 'var(--accent)';
      card.style.boxShadow = '0 0 24px var(--accent-20)';
      card.style.transition = 'all 150ms var(--ease-spring)';
      card.style.background = 'rgba(34,211,238,0.08)';

      // Phase 2: scale back to normal (150ms, starting at 150ms)
      setTimeout(() => {
        card.style.transform = 'scale(1.0)';
        card.style.transition = 'all 150ms var(--ease-out)';
      }, 150);

      // Phase 3: after full animation — advance (at 280ms)
      setTimeout(() => {
        onSelect(answerKey);
        selectingRef.current = false;
      }, 280);
    },
    [activeIndex, scrollToIndex, onSelect],
  );

  // ── Render ────────────────────────────────────────────────

  return (
    <div style={{ width: '100%' }}>
      {/* Swipe hint */}
      {!hideFooter && showSwipeHint && (
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            marginBottom: '12px',
            opacity: scrolledOnce ? 0 : 1,
            transition: 'opacity 400ms ease',
          }}
        >
          ← swipe to browse →
        </p>
      )}

      {/* Carousel container */}
      <div
        ref={containerRef}
        className="answer-carousel-scroll"
        style={{
          display: 'flex',
          overflowX: 'scroll',
          scrollSnapType: 'x mandatory',
          touchAction: 'pan-x',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          paddingLeft: '9vw',
          paddingRight: '9vw',
          gap: '14px',
        }}
      >
        {answers.map((answer, i) => {
          const isCentered = i === activeIndex;
          const isFirstCard = i === 0;

          return (
            <div
              key={answer.key}
              ref={(el) => {
                cardRefs.current[i] = el;
                registerCard(i)(el);
              }}
              className="answer-carousel-card"
              onClick={() => handleCardTap(i, answer.key)}
              style={{
                minWidth: '82vw',
                maxWidth: '82vw',
                scrollSnapAlign: 'center',
                flexShrink: 0,
                borderRadius: '20px',
                padding: '28px 24px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                // Default (inactive) state
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                transform: 'scale(0.88)',
                opacity: 0.35,
                // Centered (active) state
                ...(isCentered && {
                  transform: 'scale(1.0)',
                  opacity: 1,
                  background: 'rgba(34,211,238,0.05)',
                  border: '1px solid rgba(34,211,238,0.40)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.3), 0 0 0 1px rgba(34,211,238,0.2)',
                }),
                // First card entrance pop
                ...(isFirstCard && !isCentered && {
                  animation: `cardEnterPop-${entranceKey} 280ms ease-out`,
                }),
                // Smooth transition for all properties
                transition: 'transform 250ms var(--ease-out), opacity 250ms var(--ease-out), border-color 250ms var(--ease-out), background 250ms var(--ease-out), box-shadow 250ms var(--ease-out)',
                WebkitTapHighlightColor: 'transparent',
                userSelect: 'none',
              }}
            >
              {/* Answer text — left-aligned, Alinea-style */}
              <span
                style={{
                  fontSize: '20px',
                  lineHeight: 1.55,
                  color: isCentered
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                  fontWeight: 400,
                  textAlign: 'left' as const,
                  transition: 'color 250ms var(--ease-out)',
                }}
              >
                {answer.text}
              </span>
            </div>
          );
        })}
      </div>

      {/* Dot indicator */}
      {!hideFooter && (
        <CarouselDots total={answers.length} activeIndex={activeIndex} />
      )}

      {/* Hide scrollbar + card pop keyframes */}
      <style>{`
        .answer-carousel-scroll::-webkit-scrollbar { display: none; }
        @keyframes cardEnterPop-${entranceKey} {
          0%   { transform: scale(0.92); opacity: 0.3; }
          60%  { transform: scale(1.02); opacity: 0.85; }
          100% { transform: scale(1.0); opacity: 1.0; }
        }
      `}</style>
    </div>
  );
}
