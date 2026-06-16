// ─── CarouselDots ──────────────────────────────────────────
// Pure presentational dot row for the answer carousel.

'use client';

import React from 'react';

interface CarouselDotsProps {
  total: number;
  activeIndex: number;
}

export function CarouselDots({ total, activeIndex }: CarouselDotsProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '8px',
        marginTop: '20px',
      }}
    >
      {Array.from({ length: total }).map((_, i) => {
        const isActive = i === activeIndex;
        return (
          <div
            key={i}
            style={{
              width: isActive ? '8px' : '6px',
              height: isActive ? '8px' : '6px',
              borderRadius: '50%',
              background: isActive ? '#22d3ee' : 'rgba(255,255,255,0.2)',
              transition: 'all 200ms ease',
            }}
          />
        );
      })}
    </div>
  );
}
