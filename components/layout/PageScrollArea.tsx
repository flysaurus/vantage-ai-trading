// ─── PageScrollArea ─────────────────────────────────────────
// THE single owner of (a) a screen's scroll container and (b) the floating
// Ask Rufus bar that overlays it. Every tab renders through this component,
// so the "content hides behind the Ask Rufus bar" class of bug is
// STRUCTURALLY impossible — there is no screen that can forget the band.
//
// Why this exists (PART 4):
//   The Ask Rufus bar is `position: fixed`. A fixed element is out of flow,
//   so the scroll container underneath never knows it is there. Padding alone
//   only clears the END of the content — everything else still scrolls behind
//   the bar. The only correct reservation is a MARGIN on the scroll
//   container, which ends the scroller's viewport at the bar's top edge.
//
//   Previous attempt: a TAB-SCOPED CSS rule in app/theme.css
//     `.app-shell[data-active-tab='insights'] .content-area { margin-bottom: 132px }`
//   which fixed exactly one screen and let the next screen regress (Settings'
//   Investor Style "Save Style" button was still covered). 132px was also a
//   hardcoded guess at bar geometry.
//
//   Now: this component MEASURES the real bar (its offsetHeight + its own
//   computed `bottom` offset, so the desktop media query where the bar moves
//   to bottom:24px is handled for free) and reserves `bottom + height + gap`.
//   One component owns the scroller and the bar, so the band can never drift
//   out of sync with the bar's real geometry, in either theme, on any screen,
//   at any breakpoint.
//
// Usage: <PageScrollArea>{screen}</PageScrollArea>  — nothing else to remember.

'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { AskRufusBar } from '@/components/insights/AskRufusBar';

/** Breathing room between the last content row and the bar's top edge. */
const CONTENT_GAP = 12;

/** Pre-measure fallback (bar 54px tall + 78px bottom offset + gap). Only
 *  visible for the very first paint; overwritten by the measurement below. */
const FALLBACK_BAND = 54 + 78 + CONTENT_GAP;

export function PageScrollArea({ children }: { children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLButtonElement | null>(null);
  const [band, setBand] = useState<number>(FALLBACK_BAND);

  /** Reserve the band = the bar's own bottom offset + its height + a gap. */
  const measure = useCallback(() => {
    const el = barRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const height = Math.round(rect.height || el.offsetHeight || 54);
    // Read the bar's own `bottom` offset so the desktop breakpoint
    // (bottom: 24px, no BottomNav) needs no duplicate constant here.
    const bottomOffset = Math.round(parseFloat(getComputedStyle(el).bottom || '0') || 0);
    const next = height + bottomOffset + CONTENT_GAP;
    setBand((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    measure();
    const el = barRef.current;
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(el);
    }
    // Breakpoint changes move the bar (bottom 78px → 24px) without resizing it.
    window.addEventListener('resize', measure);
    const mq = window.matchMedia('(min-width: 1024px)');
    mq.addEventListener?.('change', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      mq.removeEventListener?.('change', measure);
    };
  }, [measure]);

  return (
    <>
      <div
        ref={scrollerRef}
        className="content-area"
        data-page-scroller="1"
        data-rufus-bar-band={band}
        style={{
          // Reserve the band by clipping the scroll viewport above the bar,
          // plus a small padding so the last row doesn't sit on the clip line.
          marginBottom: band,
          paddingBottom: 18,
          scrollPaddingBottom: band,
        }}
      >
        {children}
      </div>
      <AskRufusBar barRef={barRef} />
    </>
  );
}

export default PageScrollArea;
