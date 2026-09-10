// ─── Ask Rufus Bar ─────────────────────────────────────────
// Persistent floating bar above the bottom nav. Present on EVERY
// tab (rendered once in components/app/MainApp.tsx), including the
// Insights screen. Tapping it opens the full-screen Ask Rufus chat
// overlay.
//
// Geometry/theme per the Theming spec (design-tokens-context.md):
//   14px side margins (NOT edge-to-edge), 24px radius, orb on the
//   right, placeholder "Ask Rufus anything...".
//   Light: white fill + `0 6px 18px rgba(16,24,43,0.15)`.
//   Dark:  #0F1626 fill + lower-opacity shadow.

'use client';

import { useTabStore } from '@/store';

export function AskRufusBar() {
  const { setChatOpen } = useTabStore();

  return (
    <>
      <button
        type="button"
        className="ask-rufus-bar"
        onClick={() => setChatOpen(true)}
        aria-label="Ask Rufus anything"
        data-testid="ask-rufus-bar"
      >
        <span className="ask-rufus-placeholder">Ask Rufus anything...</span>
        <span className="ask-rufus-orb" aria-hidden="true" />
      </button>
      <style>{`
        .ask-rufus-bar {
          position: fixed;
          left: 14px;
          right: 14px;
          bottom: 78px; /* clears 64px BottomNav + 14px gap */
          z-index: 45;
          height: 48px;
          border-radius: 24px;
          background: var(--v-ask-bg);
          border: 0.5px solid var(--v-ask-border);
          box-shadow: var(--v-ask-shadow);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 10px 0 18px;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .ask-rufus-bar:hover { border-color: var(--v-ask-hover); }
        .ask-rufus-placeholder {
          font-size: 14px;
          color: var(--v-ask-placeholder);
          letter-spacing: 0.1px;
          font-family: var(--font-sans, 'Inter', sans-serif);
        }
        .ask-rufus-orb {
          width: 28px;
          height: 28px;
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
