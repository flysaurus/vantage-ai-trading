'use client';

// ─── Masthead ───────────────────────────────────────────────
// THE shared screen header (PART 3). One implementation used by BOTH the
// Insights screen and Holdings ("Portfolio") so they read as the same product:
//   row 1 — 18px gradient orb + italic-serif "Vantage" wordmark +
//           <AccountSwitcher variant="masthead"> (account name = the switcher
//           trigger; opens the same account list Settings › Accounts uses).
//   2px accent rule (the one deliberate hairline deviation).
//   row 2 — connection dot + investor-style link to Settings + (read-only
//           only) the two-weight BROKER / VIEW ONLY badge.
// All colours come from `--v-*` tokens — no hardcoded hex.
import { useState } from 'react';
import { AccountSwitcher } from '@/components/accounts/AccountSwitcher';
import { LearningLibrary } from '@/components/learning/LearningLibrary';

/**
 * Book-pile mark for the Learning Library entry point. Inline SVG (no icon
 * dependency, no emoji so it renders identically on every platform) and
 * `currentColor` so it inherits the masthead's token-driven text colour in
 * both themes.
 */
function BookPileIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* shelf / base */}
      <path d="M3 20h18" />
      {/* stacked volumes, slightly offset so it reads as a pile */}
      <rect x="4.5" y="15.2" width="15" height="3.4" rx="0.9" />
      <rect x="6" y="11.4" width="12" height="3.4" rx="0.9" />
      <rect x="7.5" y="7.6" width="9" height="3.4" rx="0.9" />
      {/* upright volume leaning on the pile */}
      <rect x="8.6" y="2.6" width="6.8" height="3.6" rx="0.9" />
    </svg>
  );
}

export interface MastheadTestIds {
  masthead: string;
  rule: string;
  header: string;
  wordmark: string;
  account: string;
}

interface Props {
  accountName: string;
  brokerLabel: string;
  dotColor: string;
  isReadOnly: boolean;
  styleLabel: string;
  onStyleClick: () => void;
  testIds: MastheadTestIds;
}

export function Masthead({ accountName, brokerLabel, dotColor, isReadOnly, styleLabel, onStyleClick, testIds }: Props) {
  // Self-contained so the entry point appears on EVERY screen that renders the
  // masthead (Insights, Holdings, Trade) without each tab re-wiring it.
  const [showLibrary, setShowLibrary] = useState(false);

  return (
    <>
      {/* ── 1. Masthead ── */}
      <div style={{ padding: '14px 20px 0' }} data-testid={testIds.masthead}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              aria-hidden="true"
              style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, background: 'var(--v-orb)' }}
            />
            <span
              data-testid={testIds.wordmark}
              style={{
                fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: 19,
                lineHeight: 1, color: 'var(--v-text-primary)', letterSpacing: '0.01em',
              }}
            >
              Vantage
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button
              type="button"
              data-testid="learning-library-entry"
              aria-label="Open Learning Library"
              title="Learning Library"
              onClick={() => setShowLibrary(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', padding: 6, margin: 0,
                cursor: 'pointer', color: 'var(--v-text-primary)',
                borderRadius: 8, fontFamily: 'inherit', lineHeight: 0,
              }}
            >
              <BookPileIcon />
            </button>
            <AccountSwitcher variant="masthead" testId={testIds.account} fallbackLabel={accountName} />
          </div>
        </div>
        {/* the ONE deliberate hairline deviation — 2px accent rule */}
        <div data-testid={testIds.rule} style={{ borderTop: '2px solid var(--v-accent)', marginTop: 12 }} />
      </div>

      {/* ── 2. Header row (single row) ── */}
      <div
        data-testid={testIds.header}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '12px 20px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            data-testid="connection-dot"
            style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }}
          />
          <button
            type="button"
            onClick={onStyleClick}
            style={{
              background: 'none', border: 'none', color: 'var(--v-accent-label)', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', padding: 0,
              whiteSpace: 'nowrap', textDecoration: 'underline', textUnderlineOffset: 3,
            }}
          >
            {styleLabel}
          </button>
        </div>
        {isReadOnly && (
          // Two-weight badge: broker NAME in bold primary text, "view only" in
          // smaller muted text — same badge, one tint, no reflow.
          <span
            data-testid="view-only-tag"
            data-broker={brokerLabel}
            style={{
              background: 'var(--v-view-only-bg)',
              borderRadius: 6,
              padding: '4px 8px 4px 8px',
              flexShrink: 0,
              display: 'inline-flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 1,
              lineHeight: 1.1,
            }}
          >
            <span
              data-testid="view-only-broker"
              style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.04em',
                color: 'var(--v-text-primary)', whiteSpace: 'nowrap',
              }}
            >
              {brokerLabel}
            </span>
            <span
              style={{
                fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em',
                color: 'var(--v-view-only-text)', whiteSpace: 'nowrap',
              }}
            >
              VIEW ONLY
            </span>
          </span>
        )}
      </div>
      {/* Learning Library overlay — the same component the chat header and Settings use. */}
      <LearningLibrary open={showLibrary} onClose={() => setShowLibrary(false)} initialView="path" />
    </>
  );
}

export default Masthead;
