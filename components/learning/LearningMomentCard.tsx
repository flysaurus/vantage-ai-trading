// ─── LearningMomentCard ──────────────────────────────────────
// Slide-up educational card triggered after AI responses that
// contain financial concepts the user may not know.
//
// Design:
// - 280px max height, slides up from bottom of screen
// - Handle bar at top (drag indicator)
// - Level pill + XP gain header
// - Term headline + body + example box
// - "Learn more →" + "Got it" footer
// - Dismiss via: "Got it", swipe down, or backdrop tap
//
// All colors via CSS design tokens.

'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getLevelColor } from '@/lib/theme/utils';
import type { LearningCard } from '@/lib/learning/triggers';
import { markConceptShown } from '@/lib/learning/detector';

// ─── Props ────────────────────────────────────────────────────

interface LearningMomentCardProps {
  card: LearningCard;
  /** Called after "Got it" — card dismisses + XP awarded */
  onGotIt: () => void;
  /** Called on dismiss without XP (swipe, backdrop, etc.) */
  onDismiss: () => void;
}

// ─── Constants ───────────────────────────────────────────────

const DISMISS_THRESHOLD = 60; // px of upward drag to dismiss

// ─── Component ───────────────────────────────────────────────

export function LearningMomentCard({
  card,
  onGotIt,
  onDismiss,
}: LearningMomentCardProps) {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering');
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const levelColor = getLevelColor(card.level);
  const investopediaUrl = card.investopediaSlug
    ? `https://www.investopedia.com/terms/${card.investopediaSlug.replace(/^\//, '')}`
    : `https://www.investopedia.com/search?q=${encodeURIComponent(card.term)}`;

  // ── Enter animation ────────────────────────────────────
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPhase('visible');
      });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Drag handlers ─────────────────────────────────────
  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Only drag on the handle area (top 40px of card)
      const cardTop = cardRef.current?.getBoundingClientRect().top ?? 0;
      if (e.touches[0].clientY - cardTop > 40) return;
      dragStartY.current = e.touches[0].clientY;
      setIsDragging(true);
    },
    []
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isDragging) return;
      const dy = e.touches[0].clientY - dragStartY.current;
      if (dy > 0) setDragOffset(dy); // only downward drag
    },
    [isDragging]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    if (dragOffset > DISMISS_THRESHOLD) {
      handleExit(onDismiss);
    }
    setDragOffset(0);
  }, [isDragging, dragOffset, onDismiss]);

  // ── Exit + Got it ─────────────────────────────────────
  function handleExit(callback: () => void) {
    setPhase('exiting');
    setTimeout(callback, 200);
  }

  function handleGotIt() {
    markConceptShown(card.term);
    setPhase('exiting');
    setTimeout(onGotIt, 200);
  }

  // ── Compute transform ─────────────────────────────────
  const translateY =
    phase === 'exiting'
      ? '100%'
      : phase === 'entering'
        ? '100%'
        : isDragging
          ? `${dragOffset}px`
          : '0';

  return (
    <>
      {/* Light backdrop */}
      <div
        onClick={() => handleExit(onDismiss)}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 8990,
          background: 'rgba(0,0,0,0.2)',
          animation: 'vantageFadeIn 0.15s ease-out',
        }}
      />

      {/* Card */}
      <div
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 8991,
          maxWidth: '480px',
          margin: '0 auto',
          maxHeight: '420px',
          background: 'var(--bg-sheet)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4) calc(var(--space-5) + env(safe-area-inset-bottom, 0px))',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          transform: `translateY(${translateY})`,
          transition: isDragging
            ? 'none'
            : 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
        }}
      >
        {/* Drag handle */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <div style={{
            width: '36px',
            height: '4px',
            borderRadius: '2px',
            background: 'var(--border-card)',
          }} />
        </div>

        {/* Header: Level pill + XP */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{
            fontSize: '10px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '3px 10px',
            borderRadius: 'var(--radius-full)',
            background: `${levelColor}26`,
            color: levelColor,
          }}>
            {card.level}
          </span>
          <span style={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--accent-primary)',
          }}>
            +{card.xp} XP
          </span>
        </div>

        {/* Term headline */}
        <span style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          lineHeight: 1.25,
          letterSpacing: '-0.01em',
        }}>
          {card.headline}
        </span>

        {/* Body */}
        <p style={{
          fontSize: '14px',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
          margin: 0,
        }}>
          {card.body}
        </p>

        {/* Example box */}
        <div style={{
          padding: '10px 12px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-primary-10)',
          borderLeft: '2px solid var(--accent-primary)',
        }}>
          <p style={{
            fontSize: '13px',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
            margin: 0,
            fontStyle: 'italic',
          }}>
            {card.example}
          </p>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'var(--space-1)',
        }}>
          <a
            href={investopediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '13px',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Learn more →
          </a>
          <button
            onClick={handleGotIt}
            style={{
              padding: '8px 20px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'var(--accent-primary)',
              color: '#0a0f1e',
              fontSize: '13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Got it
          </button>
        </div>
      </div>

      <style>{`
        @keyframes vantageFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  );
}
