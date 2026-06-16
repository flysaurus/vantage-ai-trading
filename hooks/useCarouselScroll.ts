// ─── useCarouselScroll ──────────────────────────────────────
// Tracks active card index based on horizontal scroll position.
// Applies scale/opacity transforms directly to DOM via refs
// (no per-frame React re-renders). Only activeIndex triggers
// a state update (for dots + tap logic).

'use client';

import { useRef, useState, useEffect, useCallback } from 'react';

interface UseCarouselScrollOptions {
  /** Number of cards in the carousel */
  cardCount: number;
  /** Snap tolerance in px — card within this distance of center is "active" */
  snapTolerance?: number;
}

export function useCarouselScroll({
  cardCount,
  snapTolerance = 20,
}: UseCarouselScrollOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const rafRef = useRef<number | null>(null);
  const activeIndexRef = useRef(0);

  // Register a card ref
  const registerCard = useCallback(
    (index: number) => (el: HTMLButtonElement | null) => {
      cardRefs.current[index] = el;
    },
    [],
  );

  // Scroll listener with requestAnimationFrame throttle
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (rafRef.current) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const rect = container.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;

        let closestIndex = 0;
        let closestDist = Infinity;

        cardRefs.current.forEach((card, i) => {
          if (!card) return;
          const cardRect = card.getBoundingClientRect();
          const cardCenter = cardRect.left + cardRect.width / 2;
          const dist = Math.abs(cardCenter - centerX);

          if (dist < closestDist) {
            closestDist = dist;
            closestIndex = i;
          }

          // Apply scale/opacity directly — no React re-render
          const isActive = dist <= snapTolerance + 10; // slight buffer for smoothness
          const scale = isActive ? 1 : 0.9;
          const opacity = isActive ? 1 : 0.4;
          card.style.transform = `scale(${scale})`;
          card.style.opacity = String(opacity);
          card.style.borderColor = isActive
            ? 'rgba(34,211,238,0.25)'
            : 'transparent';
        });

        if (closestIndex !== activeIndexRef.current) {
          activeIndexRef.current = closestIndex;
          setActiveIndex(closestIndex);
        }
      });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    // Run once on mount to set initial state
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [snapTolerance]);

  // Programmatic scroll to index
  const scrollToIndex = useCallback((index: number) => {
    const card = cardRefs.current[index];
    if (!card || !containerRef.current) return;
    const container = containerRef.current;
    const cardLeft = card.offsetLeft;
    const cardWidth = card.offsetWidth;
    const containerWidth = container.offsetWidth;
    const scrollTarget = cardLeft - (containerWidth - cardWidth) / 2;
    container.scrollTo({ left: scrollTarget, behavior: 'smooth' });
  }, []);

  return {
    containerRef,
    registerCard,
    activeIndex,
    scrollToIndex,
  };
}
