// ─── Insights hero deck: swipeable, BROWSE-ONLY ─────────────
//
// Swipe is horizontal navigation and NOTHING ELSE.
//
// Guarantees that swipe can never fire a CTA / dismiss / snack:
//   1. Scrolling is native (`overflow-x:auto` + scroll-snap) or a plain
//      pointer-drag that only ever writes `scrollLeft`.
//   2. There is no touchstart/touchend/pointerup handler that calls an
//      action — the only action handlers in this subtree are onClick on
//      real <button> elements inside InsightsCard.
//   3. Defense in depth: if a pointer drag moved more than 6px, the next
//      click is swallowed at the capture phase (`onClickCapture`), so a
//      drag that ends on top of a button cannot fire that button.
//   (Verified by qa-agent/verify-insights.cjs scenario E — see qa-agent/VERIFICATION.md.)

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Position } from '@/types';
import { InsightCard } from './InsightCard';
import type { DeckCard } from '@/lib/insights/deck';

interface HeroDeckProps {
  cards: DeckCard[];
  positions: Position[];
  isReadOnly: boolean;
  onDismiss: (itemId: string, dismissType: string) => void;
  onOpenTeaser: (kind: 'daily_brief' | 'weekly_snapshot') => void;
}

const SNOOZE_OPTIONS: { label: string; type: string }[] = [
  { label: 'Remind in 3 days', type: '3d' },
  { label: 'Remind in 5 days', type: '5d' },
  { label: 'Remind in 1 week', type: '1w' },
  { label: 'Remind in 2 weeks', type: '14d' },
  { label: "Don't remind again", type: 'permanent' },
];

export function HeroDeck({ cards, positions, isReadOnly, onDismiss, onOpenTeaser }: HeroDeckProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  // ── Swipe guards ──
  const suppressClickRef = useRef(false);
  const dragRef = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);

  // Active dot = the card whose centre is closest to the viewport centre.
  const syncActive = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const mid = el.getBoundingClientRect().left + el.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const r = (child as HTMLElement).getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    setActive(best);
  }, []);

  useEffect(() => {
    syncActive();
  }, [cards.length, syncActive]);

  const onScroll = useCallback(() => {
    // rAF-throttled by the browser's scroll event coalescing; cheap enough.
    syncActive();
  }, [syncActive]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return; // touch uses native scroll
    const el = scrollerRef.current;
    if (!el) return;
    dragRef.current = { x: e.clientX, scroll: el.scrollLeft, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = scrollerRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    el.scrollLeft = d.scroll - dx;
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      // Swallow the click that the browser is about to synthesise.
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 350);
    }
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClickRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div data-testid="hero-deck-wrap">
      <div
        ref={scrollerRef}
        className="hero-deck"
        data-testid="hero-deck"
        data-active-index={active}
        data-card-count={cards.length}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onDragStart={(e) => e.preventDefault()}
      >
        {cards.map((c) => (
          <InsightCard
            key={c.id}
            card={c}
            positions={positions}
            isReadOnly={isReadOnly}
            onSnooze={(id) => setSnoozeFor(id)}
            onOpenTeaser={onOpenTeaser}
          />
        ))}
      </div>

      {/* dot indicator — position + count */}
      <div
        data-testid="deck-dots"
        data-active-index={active}
        style={{ display: 'flex', justifyContent: 'center', gap: 6, marginTop: 12 }}
        aria-label={`Card ${active + 1} of ${cards.length}`}
      >
        {cards.map((c, i) => (
          <span
            key={c.id}
            data-testid="deck-dot"
            data-index={i}
            data-active={i === active ? 'true' : 'false'}
            style={{
              width: i === active ? 18 : 6,
              height: 6,
              borderRadius: 999,
              background: i === active ? 'var(--v-accent)' : 'var(--v-card-border)',
              transition: 'width 0.2s ease, background 0.2s ease',
            }}
          />
        ))}
      </div>

      {/* snooze picker — explicit tap only; opens from the card's snooze button */}
      {snoozeFor && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setSnoozeFor(null)}
          />
          <div
            data-testid="snooze-sheet"
            style={{
              position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 120,
              zIndex: 9999, background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)',
              borderRadius: 14, padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
              minWidth: 200, boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
            }}
          >
            {SNOOZE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                data-testid={`snooze-option-${opt.type}`}
                onClick={(e) => { e.stopPropagation(); setSnoozeFor(null); onDismiss(snoozeFor, opt.type); }}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--v-text-secondary)',
                  fontSize: 12.5, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}

      <style>{`
        .hero-deck {
          display: flex;
          gap: 12px;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-snap-type: x mandatory;
          scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          padding: 4px 20px 2px;
          margin: 0 -20px;
        }
        .hero-deck::-webkit-scrollbar { display: none; }
        .hero-deck > * { width: min(86vw, 320px); }
        .hero-deck.hero-deck--settled { cursor: default; }
      `}</style>
    </div>
  );
}

export default HeroDeck;
