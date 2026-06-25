// ─── useWordHighlight ──────────────────────────────────────
// Word-by-word highlight animation. Each word illuminates
// cyan briefly then settles to bright white — like an AI
// reading the text aloud.
//
// Usage:
//   const { words, activeIndex, completedIndices, isComplete, skip } =
//     useWordHighlight(description, 400, paused, onComplete);

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const WORD_MS = 120;
const GAP_MS = 40;
const SETTLE_MS = 80;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UseWordHighlightResult {
  words: string[];
  activeIndex: number;
  completedIndices: Set<number>;
  isComplete: boolean;
  skip: () => void;
}

export function useWordHighlight(
  text: string,
  startDelay: number = 0,
  paused: boolean = false,
  onComplete?: () => void,
): UseWordHighlightResult {
  const words = text.split(' ');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [completedIndices, setCompletedIndices] = useState<Set<number>>(new Set());
  const [isComplete, setIsComplete] = useState(false);
  const skippedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const skip = useCallback(() => {
    if (isComplete) return;
    skippedRef.current = true;
    const all = new Set<number>();
    for (let i = 0; i < words.length; i++) all.add(i);
    setCompletedIndices(all);
    setActiveIndex(-1);
    setIsComplete(true);
    onCompleteRef.current?.();
  }, [words.length, isComplete]);

  useEffect(() => {
    // Reset state whenever text or paused changes
    setActiveIndex(-1);
    setCompletedIndices(new Set());
    setIsComplete(false);

    // Don't run while paused
    if (paused) return;

    let cancelled = false;
    skippedRef.current = false;

    async function run() {
      await sleep(startDelay);

      for (let i = 0; i < words.length; i++) {
        if (cancelled || skippedRef.current) return;

        setActiveIndex(i);
        await sleep(WORD_MS);

        if (cancelled || skippedRef.current) return;
        setActiveIndex(-1);
        setCompletedIndices((prev) => {
          const next = new Set(prev);
          next.add(i);
          return next;
        });
        await sleep(GAP_MS);
      }

      if (!cancelled && !skippedRef.current) {
        await sleep(SETTLE_MS);
        setIsComplete(true);
        onCompleteRef.current?.();
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [text, startDelay, paused]);

  return { words, activeIndex, completedIndices, isComplete, skip };
}
