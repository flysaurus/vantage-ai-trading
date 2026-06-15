// ─── MilestoneToast ──────────────────────────────────────────
// Slides down from top of screen when a milestone is unlocked.
//
// Design:
// - 64px height, full width with 16px padding
// - Background: --milestone-color at 12% opacity
// - Border: 1px --milestone-color at 30%
// - Rounded: var(--radius-md)
// - Enter: translateY(-100%) → 0 (300ms spring)
// - Exit: translateY(0) → -100% (200ms ease-in)
// - Auto-dismiss after 4s, tap anywhere dismisses early
//
// All colors via CSS design tokens.

'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { MilestoneToastEntry } from '@/context/MilestoneContext';

// ─── Props ────────────────────────────────────────────────────

export interface MilestoneToastProps {
  toast: MilestoneToastEntry;
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss (default 4000) */
  duration?: number;
}

// ─── Component ───────────────────────────────────────────────

export function MilestoneToast({
  toast,
  onDismiss,
  duration = 4000,
}: MilestoneToastProps) {
  const [phase, setPhase] = useState<'entering' | 'visible' | 'exiting'>('entering');
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { def } = toast;

  // ── Phase transitions ─────────────────────────────────
  useEffect(() => {
    // Kick enter animation on next frame (offscreen → slide in)
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPhase('visible');
      });
    });

    // Auto-dismiss after duration (+50ms to account for double-RAF delay)
    autoDismissRef.current = setTimeout(() => {
      handleDismiss();
    }, duration + 50);

    return () => {
      cancelAnimationFrame(raf);
      if (autoDismissRef.current) clearTimeout(autoDismissRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dismiss handler ───────────────────────────────────
  function handleDismiss() {
    if (phase === 'exiting') return;
    setPhase('exiting');

    // Clear auto-dismiss timer
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }

    // Wait for exit animation then fire callback
    setTimeout(() => {
      onDismiss();
    }, 200);
  }

  // ── Style helpers ─────────────────────────────────────
  const toastStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9000,
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: '0 var(--space-4)',
    background: 'var(--milestone-color-12)',
    borderBottom: '1px solid var(--milestone-color-30)',
    transform:
      phase === 'exiting'
        ? 'translateY(-100%)'
        : phase === 'entering'
          ? 'translateY(-100%)'
          : 'translateY(0)',
    transition:
      phase === 'exiting'
        ? 'transform 200ms ease-in'
        : 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
  };

  return (
    <>
      <div
        style={toastStyle}
        onClick={handleDismiss}
        role="alert"
        aria-live="polite"
      >
        {/* Left: Emoji icon */}
        <span
          style={{
            fontSize: '32px',
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {def.icon}
        </span>

        {/* Center: Label + Name */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--milestone-color)',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            lineHeight: 1,
          }}>
            Achievement Unlocked
          </span>
          <span style={{
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {def.label}
          </span>
        </div>

        {/* Right: Score gain pill */}
        <span style={{
          fontSize: '12px',
          fontWeight: 700,
          padding: '4px 10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--accent-primary-15)',
          color: 'var(--accent-primary)',
          flexShrink: 0,
          letterSpacing: '-0.01em',
        }}>
          +{def.points} pts
        </span>
      </div>

    </>
  );
}
