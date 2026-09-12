// ═══════════════════════════════════════════════════════════════
// components/disclosure/TaxHarvestDisclosureGate.tsx
// ═══════════════════════════════════════════════════════════════
// Blocking, non-dismissible full-screen gate shown before the Tax Loss
// Harvesting surface becomes usable. Unlike the FIFO explainer this is
// NOT a friendly dismissible popup: there is no click-outside close and
// no ESC close. The only exits are Accept (proceeds) and Cancel
// (leaves the flow entirely, handled by the owner of the page).
//
// Mirrors the structure of components/disclosure/FIFOExplainer.tsx:
// 'use client', createPortal, usePageScrollLock + SCROLL_SCOPE_ATTR.
// Theming uses only existing --v-* CSS vars so it renders correctly in
// both light and dark. Tone is neutral/informational — amber/teal accent,
// no red or alarm styling, no warning icon.
// ═══════════════════════════════════════════════════════════════

'use client';

import { createPortal } from 'react-dom';
import { usePageScrollLock, SCROLL_SCOPE_ATTR } from '@/lib/ui/scroll-lock';
import {
  TLH_DISCLOSURE_TITLE,
  TLH_DISCLOSURE_PARAGRAPHS,
  TLH_DISCLOSURE_ACCEPT_LABEL,
  TLH_DISCLOSURE_CANCEL_LABEL,
} from '@/lib/tax-harvest/disclosure';

export interface TaxHarvestDisclosureGateProps {
  isOpen: boolean;
  /** Optional account name to make it clear which account this covers. */
  accountLabel?: string | null;
  onAccept: () => void;
  onCancel: () => void;
}

export default function TaxHarvestDisclosureGate({
  isOpen,
  accountLabel,
  onAccept,
  onCancel,
}: TaxHarvestDisclosureGateProps) {
  // Locks the app's real scrollers (.content-area / [data-page-scroller]),
  // not just <body>. Same behaviour as the FIFO explainer.
  usePageScrollLock(isOpen);

  if (!isOpen) return null;

  return createPortal(
    <div
      {...{ [SCROLL_SCOPE_ATTR]: 'tlh-disclosure-gate' }}
      data-testid="tlh-disclosure-gate"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--v-card)',
          border: '0.5px solid var(--v-card-border)',
          borderRadius: 20,
          maxWidth: 440, width: '100%',
          maxHeight: '88vh', overflowY: 'auto',
          padding: 24,
          display: 'flex', flexDirection: 'column', gap: 16,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* ── Header ── */}
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--v-warn)',
          }}>
            Disclosure
          </div>
          <h2 style={{
            fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500,
            fontSize: 22, color: 'var(--v-text-primary)', margin: '4px 0 0',
            letterSpacing: 0,
          }}>
            {TLH_DISCLOSURE_TITLE}
          </h2>
          {accountLabel ? (
            <div style={{
              fontSize: 12, color: 'var(--v-text-secondary)', marginTop: 6,
            }}>
              {accountLabel}
            </div>
          ) : null}
        </div>

        {/* ── Body ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TLH_DISCLOSURE_PARAGRAPHS.map((paragraph, i) => (
            <p
              key={i}
              style={{
                fontSize: 13, lineHeight: 1.6, margin: 0,
                color: 'var(--v-text-secondary)',
              }}
            >
              {paragraph}
            </p>
          ))}
        </div>

        {/* ── Actions ── */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            data-testid="tlh-disclosure-cancel"
            onClick={onCancel}
            style={{
              flex: 1, padding: '13px 16px', borderRadius: 12,
              background: 'transparent',
              border: '1px solid var(--v-card-border)',
              color: 'var(--v-text-primary)',
              fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            {TLH_DISCLOSURE_CANCEL_LABEL}
          </button>
          <button
            type="button"
            data-testid="tlh-disclosure-accept"
            onClick={onAccept}
            style={{
              flex: 1.4, padding: '13px 16px', borderRadius: 12,
              background: 'var(--v-accent)',
              border: 'none',
              color: 'var(--v-accent-text)',
              fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
          >
            {TLH_DISCLOSURE_ACCEPT_LABEL}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
