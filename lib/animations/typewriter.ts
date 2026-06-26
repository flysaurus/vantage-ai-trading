'use client';

import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for typewriter text reveal.
 * Types one character at a time with configurable speed and delay.
 *
 * @param text      The full string to reveal character-by-character.
 * @param speed     Milliseconds between each character (default 30).
 * @param startDelay Milliseconds to wait before typing begins (default 0).
 * @returns         `{ displayText, isDone }` — current revealed substring and completion flag.
 */
export function useTypewriter(
  text: string,
  speed: number = 30,
  startDelay: number = 0,
): { displayText: string; isDone: boolean } {
  const [displayText, setDisplayText] = useState('');
  const [isDone, setIsDone] = useState(false);
  const indexRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Reset on text change
    setDisplayText('');
    setIsDone(false);
    indexRef.current = 0;

    // Clear any previous timers
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (startTimerRef.current) clearTimeout(startTimerRef.current);

    if (!text) {
      setIsDone(true);
      return;
    }

    const begin = () => {
      intervalRef.current = setInterval(() => {
        indexRef.current += 1;
        if (indexRef.current >= text.length) {
          setDisplayText(text);
          setIsDone(true);
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
        } else {
          setDisplayText(text.slice(0, indexRef.current + 1));
        }
      }, speed);
    };

    if (startDelay > 0) {
      startTimerRef.current = setTimeout(begin, startDelay);
    } else {
      begin();
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (startTimerRef.current) clearTimeout(startTimerRef.current);
    };
  }, [text, speed, startDelay]);

  return { displayText, isDone };
}
