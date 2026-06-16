// ─── useTypewriter Hook ──────────────────────────────────────
// Types text character by character at given ms per char speed.

'use client';

import { useState, useEffect, useRef } from 'react';

interface TypewriterResult {
  displayText: string;
  isDone: boolean;
}

export function useTypewriter(
  text: string,
  speedMs: number,
  startDelay: number = 0,
): TypewriterResult {
  const [displayText, setDisplayText] = useState('');
  const [isDone, setIsDone] = useState(false);
  const charIndexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    charIndexRef.current = 0;
    setDisplayText('');
    setIsDone(false);

    const start = () => {
      timerRef.current = setInterval(() => {
        charIndexRef.current += 1;
        if (charIndexRef.current >= text.length) {
          setDisplayText(text);
          setIsDone(true);
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        } else {
          setDisplayText(text.slice(0, charIndexRef.current + 1));
        }
      }, speedMs);
    };

    if (startDelay > 0) {
      const delayTimer = setTimeout(start, startDelay);
      return () => {
        clearTimeout(delayTimer);
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      start();
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [text, speedMs, startDelay]);

  return { displayText, isDone };
}
