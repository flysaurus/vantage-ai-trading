// ─── AnswerCarousel ────────────────────────────────────────
// Horizontal swipeable carousel of answer cards.
// One card centered at a time with partial peeks at neighbors.
// Like Tinder/App Store browsing, not a form.
//
// Two-step tap logic:
//   Tap non-centered card → scroll it to center (no selection)
//   Tap centered card → selection with pulse animation → advance

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
}

export function AnswerCarousel({
  answers,
  onSelect,
  isFirstQuestion,
}: AnswerCarouselProps) {
  const { containerRef, registerCard, activeIndex, scrollToIndex } =
    useCarouselScroll({ cardCount: answers.length });

  const [selecting, setSelecting] = useState<string | null>(null);
  const [scrolledOnce, setScrolledOnce] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const swipeHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Swipe hint visibility
  useEffect(() => {
    if (!isFirstQuestion) return;
    const alreadyShown =
      typeof window !== 'undefined' &&
      sessionStorage.getItem('vantage_swipe_hint_shown') === 'true';
    if (!alreadyShown) {
      setShowSwipeHint(true);
    }
  }, [isFirstQuestion]);

  // On first scroll, hide the swipe hint permanently
  useEffect(() => {
    if (!showSwipeHint || scrolledOnce) return;
    if (activeIndex !== 0) {
      setScrolledOnce(true);
      // Fade out
      if (swipeHintTimer.current) clearTimeout(swipeHintTimer.current);
      swipeHintTimer.current = setTimeout(() => {
        setShowSwipeHint(false);
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('vantage_swipe_hint_shown', 'true');
        }
      }, 400);
    }
  }, [activeIndex, showSwipeHint, scrolledOnce]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (swipeHintTimer.current) clearTimeout(swipeHintTimer.current);
    };
  }, []);

  // Handle tap on a card
  const handleTap = useCallback(
    (index: number) => {
      if (selecting) return; // mid-animation, ignore

      if (index !== activeIndex) {
        // Tap non-centered card: scroll it to center, don't select
        scrollToIndex(index);
        return;
      }

      // Tap centered card: select it
      const answer = answers[index];
      setSelecting(answer.key);

      // Delay to let pulse animation play, then advance
      setTimeout(() => {
        onSelect(answer.key);
        setSelecting(null);
      }, 280);
    },
    [activeIndex, selecting, answers, scrollToIndex, onSelect],
  );

  const letters = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div>
      {/* Swipe hint */}
      {showSwipeHint && (
        <p
          style={{
            fontSize: '13px',
            color: '#64748b',
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
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          paddingLeft: '11vw',
          paddingRight: '11vw',
          gap: '12px',
        }}
      >

        {answers.map((answer, i) => {
          const isSelected = selecting === answer.key;
          return (
            <button
              key={answer.key}
              ref={registerCard(i)}
              className="answer-carousel-card"
              onClick={() => handleTap(i)}
              style={{
                minWidth: '78vw',
                maxWidth: '78vw',
                scrollSnapAlign: 'center',
                flexShrink: 0,
                background: isSelected
                  ? 'rgba(34, 211, 238, 0.08)'
                  : '#1a2235',
                border: '1px solid transparent',
                borderRadius: '18px',
                padding: '24px 20px',
                minHeight: '220px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                cursor: 'pointer',
                transform: 'scale(0.9)',
                opacity: 0.4,
                transition: 'transform 200ms ease-out, opacity 200ms ease-out, border-color 200ms ease-out',
                // Selection pulse
                ...(isSelected && {
                  transform: 'scale(1.04)',
                  borderColor: '#22d3ee',
                  boxShadow: '0 0 24px rgba(34,211,238,0.25)',
                  textAlign: 'left' as const,
                }),
              }}
            >
              {/* Letter badge (small, de-emphasized) */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: isSelected
                    ? '#22d3ee'
                    : 'rgba(34, 211, 238, 0.12)',
                  color: isSelected ? '#0a0f1e' : '#64748b',
                  fontSize: '11px',
                  fontWeight: 600,
                  marginBottom: '16px',
                  transition: 'all 150ms ease',
                }}
              >
                {letters[i]}
              </span>

              {/* Answer text */}
              <span
                style={{
                  fontSize: '18px',
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  lineHeight: 1.5,
                  fontWeight: isSelected ? 500 : 400,
                  transition: 'color 150ms ease',
                }}
              >
                {answer.text}
              </span>
            </button>
          );
        })}
      </div>

      {/* Dot indicator */}
      <CarouselDots total={answers.length} activeIndex={activeIndex} />

      {/* Hide scrollbar globally for this component */}
      <style>{`
        .answer-carousel-scroll::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
