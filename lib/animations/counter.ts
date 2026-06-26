'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Ease-out cubic curve. Maps t ∈ [0, 1] → eased value ∈ [0, 1].
 * Fast start, decelerating toward the target.
 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Custom hook for animated number count-up.
 * Smoothly interpolates from the previous value to `target` over `duration` ms.
 *
 * @param target   The number to animate toward.
 * @param duration Animation duration in milliseconds (default 600).
 * @returns        The current display number (interpolated).
 */
export function useCountUp(target: number, duration: number = 600): number {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const startValueRef = useRef(target);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // On target change, animate from the current display value
    const from = display;
    const to = target;
    if (from === to) return;

    startValueRef.current = from;
    startTimeRef.current = null;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const rawProgress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(rawProgress);
      const currentValue = from + (to - from) * easedProgress;

      setDisplay(currentValue);

      if (rawProgress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [target, duration]);

  return display;
}
