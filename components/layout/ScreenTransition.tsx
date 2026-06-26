'use client';

import React, { useState, useEffect, useRef } from 'react';
import { transitions, type TransitionName } from '@/lib/animations/transitions';

interface ScreenTransitionProps {
  children: React.ReactNode;
  direction: 'forward' | 'back' | 'up' | 'fade';
  /** Key change triggers re-animation (e.g., route path or step index) */
  transitionKey: string;
}

/**
 * ScreenTransition wraps children in a CSS-transitioned container.
 * On mount or key change the "initial" styles are applied, then on
 * the next frame they're swapped to "animate". Unmount (when key changes
 * before new mount) applies "exit" styles.
 *
 * Direction mapping:
 *   forward → slideLeft  (new screen enters from right)
 *   back    → slideRight (new screen enters from left)
 *   up      → slideUp    (sheets, modals)
 *   fade    → fade       (overlays, toasts)
 */
const DIRECTION_MAP: Record<ScreenTransitionProps['direction'], TransitionName> = {
  forward: 'slideLeft',
  back: 'slideRight',
  up: 'slideUp',
  fade: 'fade',
};

export default function ScreenTransition({
  children,
  direction,
  transitionKey,
}: ScreenTransitionProps) {
  const t = transitions[DIRECTION_MAP[direction]];
  const [phase, setPhase] = useState<'initial' | 'animate'>('initial');
  const frameRef = useRef<number | null>(null);
  const prevKey = useRef(transitionKey);

  useEffect(() => {
    // Reset to initial on key change
    if (prevKey.current !== transitionKey) {
      setPhase('initial');
    }
    prevKey.current = transitionKey;

    // On next frame, switch to animate phase (triggers CSS transition)
    frameRef.current = requestAnimationFrame(() => {
      setPhase('animate');
    });

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [transitionKey]);

  const isInitial = phase === 'initial';
  const styles: React.CSSProperties = isInitial
    ? {
        transform: t.initial.transform,
        opacity: t.initial.opacity,
        transition: 'none',
      }
    : {
        transform: t.animate.transform,
        opacity: t.animate.opacity,
        transition: t.animate.transition ?? 'all var(--duration-base) var(--ease-out)',
      };

  return <div style={styles}>{children}</div>;
}
