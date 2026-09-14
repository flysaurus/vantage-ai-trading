// ─── Ask Rufus Bar ─────────────────────────────────────────
// Persistent floating bar above the bottom nav. Present on EVERY
// tab (rendered once in components/app/MainApp.tsx), including the
// Insights screen. Tapping it opens the full-screen Ask Rufus chat
// overlay.
//
// Geometry/theme per the Theming spec (design-tokens-context.md):
//   14px side margins (NOT edge-to-edge), 24px radius, orb on the
//   right, placeholder "Ask about your portfolio...".
//   Light: white fill + `0 6px 18px rgba(16,24,43,0.15)`.
//   Dark:  #0F1626 fill + lower-opacity shadow.
//   Prominence: 54px tall, 1px ACCENT border (teal light / cyan dark —
//   flat, no glow, no gradient). Same position/shadow as before.

'use client';

import { useTabStore } from '@/store';

/**
 * The bar is rendered by <PageScrollArea> (components/layout/PageScrollArea.tsx),
 * which measures it to reserve the correct scroll band above it. The ref below
 * is how that measurement reaches the real DOM node — there is no hardcoded
 * bar height anywhere in the layout.
 */
export function AskRufusBar({
  barRef,
}: {
  barRef?: React.RefObject<HTMLButtonElement | null>;
} = {}) {
  const { setChatOpen } = useTabStore();

  return (
    <>
      <button
        ref={barRef}
        type="button"
        className="ask-rufus-bar"
        onClick={() => setChatOpen(true)}
        aria-label="Ask about your portfolio"
        data-testid="ask-rufus-bar"
      >
        <span className="ask-rufus-placeholder">Ask about your portfolio...</span>
        <span className="ask-rufus-orb" aria-hidden="true" />
      </button>
      <style>{`
        .ask-rufus-bar {
          position: fixed;
          left: 14px;
          right: 14px;
          bottom: 78px; /* clears 64px BottomNav + 14px gap */
          z-index: 45;
          height: 54px;
          border-radius: 27px;
          background: var(--v-ask-bg);
          border: 1px solid var(--v-accent);
          box-shadow: var(--v-ask-shadow);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px 0 20px;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .ask-rufus-bar:hover { border-color: var(--v-accent); box-shadow: var(--v-ask-shadow), 0 0 0 3px var(--v-ask-hover-ring); }
        .ask-rufus-placeholder {
          font-size: 14.5px;
          font-weight: 500;
          color: var(--v-ask-placeholder);
          letter-spacing: 0.1px;
          font-family: var(--font-sans, 'Inter', sans-serif);
        }
        .ask-rufus-orb {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--v-orb);
          box-shadow: 0 0 14px rgba(95, 216, 222, 0.45);
        }
        @media (min-width: 1024px) {
          .ask-rufus-bar {
            left: 244px; /* clears 220px DesktopSidebar */
            right: 24px;
            bottom: 24px;
          }
        }
      `}</style>
    </>
  );
}

export default AskRufusBar;
