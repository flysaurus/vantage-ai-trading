'use client';

/**
 * Page scroll lock for fixed overlays — the real thing, not just
 * `document.body.style.overflow = 'hidden'`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Insights (and Portfolio) screens never scroll on `<body>`. They scroll
 * inside the inner `.content-area` flex scroller (see `app/globals.css`:
 * `flex: 1; overflow-y: auto; min-height: 0`). Locking `<body>` — which is what
 * the brief sheet used to do — therefore locks nothing on this app. A drag that
 * starts over the dim, or momentum that runs past the end of the sheet's own
 * scroll area, chains into `.content-area` and visibly drags the page behind
 * the overlay while the sheet stays put.
 *
 * WHAT IT DOES
 * ------------
 *  1. Finds every container that can ACTUALLY scroll right now (body/html, the
 *     `.content-area` scroller, plus any other element whose computed
 *     `overflow-y` is auto/scroll/overlay with overflowing content) and pins
 *     `overflow: hidden` + `overscroll-behavior: contain` on each.
 *  2. Belt and braces for iOS — where `overflow: hidden` on a scroll container
 *     is not reliably honoured for touch — by cancelling `touchmove` events
 *     that do NOT originate inside an element marked `data-scroll-scope`. The
 *     overlay's own scroll area is marked with that attribute, so the sheet
 *     still scrolls and everything else cannot.
 *  3. Reference counts. Nested overlays release only when the last one closes,
 *     and the previous inline styles are restored exactly (never a blanket
 *     reset), so the page is never left locked after a close.
 *
 * Usage:
 *   usePageScrollLock(open);                 // in a component
 *   ... <div data-scroll-scope="sheet" />    // the overlay's own scroller
 */

import { useEffect } from 'react';

/** Mark the overlay's own scrollable area with this attribute. */
export const SCROLL_SCOPE_ATTR = 'data-scroll-scope';

/** Elements that are known to scroll on this app, checked first. */
const KNOWN_SCROLLERS = '.content-area, [data-page-scroller]';

/** Safety net: don't style-read an unbounded DOM. */
const SWEEP_LIMIT = 400;

type SavedStyle = { el: HTMLElement; overflow: string; overscroll: string; scrollTop: number };

let depth = 0;
let saved: SavedStyle[] = [];
let touchHandler: ((e: TouchEvent) => void) | null = null;

function canScroll(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  const oy = cs.overflowY;
  if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
  return el.scrollHeight > el.clientHeight + 1;
}

function scrollContainers(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const push = (el: Element | null) => {
    if (el instanceof HTMLElement && !out.includes(el)) out.push(el);
  };

  // 1. the document scrollers
  push(document.documentElement);
  push(document.body);

  // 2. the app's real inner scroller(s)
  document.querySelectorAll(KNOWN_SCROLLERS).forEach((el) => push(el));

  // 3. anything else that is genuinely scrollable right now (bounded sweep)
  if (out.length < 3) {
    const candidates = document.body.querySelectorAll('div, main, section, aside, ul, ol');
    for (let i = 0; i < candidates.length && i < SWEEP_LIMIT; i++) {
      const el = candidates[i];
      if (!(el instanceof HTMLElement) || out.includes(el)) continue;
      if (canScroll(el)) push(el);
      if (out.length >= 4) break;
    }
  }
  return out;
}

/**
 * Lock page scrolling. Returns the release function; safe to call once per
 * overlay and to nest.
 */
export function lockPageScroll(): () => void {
  depth += 1;

  if (depth === 1) {
    saved = [];
    scrollContainers().forEach((el) => {
      saved.push({
        el,
        overflow: el.style.overflow,
        overscroll: el.style.overscrollBehavior,
        // `overflow: hidden` clamps scrollTop if the content transiently shrinks
        // while the overlay is open (the Insights screen re-renders during an
        // account refresh). Remember where it was so we can put it back.
        scrollTop: el.scrollTop,
      });
      el.style.overflow = 'hidden';
      // keep a stray swipe from chaining out of this container
      el.style.overscrollBehavior = 'contain';
    });

    touchHandler = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest(`[${SCROLL_SCOPE_ATTR}]`)) {
        return; // inside the overlay's own scroll area — let it scroll
      }
      if (e.cancelable) e.preventDefault();
    };
    document.addEventListener('touchmove', touchHandler, { passive: false });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth > 0) return; // another overlay still holds the lock

    saved.forEach(({ el, overflow, overscroll, scrollTop }) => {
      el.style.overflow = overflow;
      el.style.overscrollBehavior = overscroll;
      // restore the reading position the locked scroller had on open (no-op if
      // nothing clamped it)
      if (scrollTop && Math.abs(el.scrollTop - scrollTop) > 1) el.scrollTop = scrollTop;
    });
    saved = [];
    if (touchHandler) {
      document.removeEventListener('touchmove', touchHandler);
      touchHandler = null;
    }
  };
}

/** React helper: locks while `active` is true, releases on close/unmount. */
export function usePageScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    return lockPageScroll();
  }, [active]);
}
