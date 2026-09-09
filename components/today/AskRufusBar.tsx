// ─── Ask Rufus Bar ─────────────────────────────────────────
// Persistent floating bar above the bottom nav on every tab.
// Tapping it opens the full-screen Ask Rufus chat overlay
// (resumes the most recent conversation). Uses the finalized
// accent tokens (#5FD8DE / #0F1626 / #5C6478).

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
      >
        <span className="ask-rufus-placeholder">Ask Rufus anything...</span>
        <span className="ask-rufus-orb" aria-hidden="true" />
      </button>
      <style>{`
        .ask-rufus-bar {
          position: fixed;
          left: 16px;
          right: 16px;
          bottom: 76px; /* above 64px BottomNav */
          z-index: 45;
          height: 48px;
          border-radius: 20px;
          background: #0F1626;
          border: 0.5px solid #141C2E;
          box-shadow: 0 10px 32px rgba(0, 0, 0, 0.38);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 12px 0 18px;
          cursor: pointer;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .ask-rufus-bar:hover { border-color: #2A3648; }
        .ask-rufus-placeholder {
          font-size: 14px;
          color: #5C6478;
          letter-spacing: 0.1px;
          font-family: var(--font-sans, 'Inter', sans-serif);
        }
        .ask-rufus-orb {
          width: 28px;
          height: 28px;
          border-radius: 50%;
          flex-shrink: 0;
          background: radial-gradient(circle at 32% 30%, #B8F2F5 0%, #5FD8DE 35%, #1B8A93 65%, #00272B 100%);
          box-shadow: 0 0 14px rgba(95, 216, 222, 0.5);
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
