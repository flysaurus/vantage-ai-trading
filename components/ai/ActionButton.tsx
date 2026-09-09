'use client';

import React from 'react';

// ─── ActionButton — inline CTA for AI Noticed cards ──────────────
// Renders below a noticed card's copy. The action string is emitted
// DETERMINISTICALLY by the rules engine (never free-text LLM parsing):
//   'REBALANCE'                 → concentration-risk / allocation drift
//   'REVIEW_POSITION:<TICKER>'  → single-position flag
//   'INVEST_CASH:<amount>'      → idle-cash suggestion (dollar amount)
// Primary CTA uses the existing cyan-fill token. The secondary control is a
// lightweight "Remind in Nd" text link (default 5 days) that opens the
// snooze picker — replacing the old bare "Dismiss" button.
//
// REBALANCE is the one action with a dual-CTA layout:
//   - trade-enabled → "Trade" (primary, execution flow) + "Download" (link)
//   - read-only     → "Download" only (downloadable proposal, no execution)

interface ActionButtonProps {
  action: string;
  onRebalance?: () => void;
  onReviewPosition?: (ticker: string) => void;
  onInvestCash?: (amount: number) => void;
  onDismiss?: () => void;
  /**
   * Optional: download-only secondary CTA for REBALANCE. Falls back to
   * `onRebalance` when not provided (the rebalance flow always produces a
   * downloadable plan).
   */
  onDownload?: () => void;
  disabled?: boolean;
  /**
   * True when the account cannot place orders (read-only connection).
   * REBALANCE shows a single "Download" instead of Trade + Download.
   */
  readOnly?: boolean;
  /** Hide the secondary "Remind in Nd" control (e.g. persistent inline cards). */
  showDismiss?: boolean;
  /** Render inline (no outer horizontal/bottom padding) for cards that already
   *  provide their own padding — e.g. the Portfolio-tab hero card. */
  flush?: boolean;
}

export default function ActionButton({
  action,
  onRebalance,
  onReviewPosition,
  onInvestCash,
  onDismiss,
  onDownload,
  disabled = false,
  readOnly = false,
  showDismiss = true,
  flush = false,
}: ActionButtonProps) {
  let primaryLabel = '';
  let onPrimary: (() => void) | undefined;
  // Secondary "Download" link — only for trade-enabled REBALANCE.
  let downloadLabel = '';
  let onDownloadLink: (() => void) | undefined;

  if (action === 'REBALANCE') {
    if (readOnly) {
      primaryLabel = 'Download';
      onPrimary = onRebalance;
    } else {
      primaryLabel = 'Trade';
      onPrimary = onRebalance;
      downloadLabel = 'Download';
      onDownloadLink = onDownload ?? onRebalance;
    }
  } else if (action.startsWith('REVIEW_POSITION:')) {
    const ticker = action.slice('REVIEW_POSITION:'.length).trim();
    if (ticker) {
      primaryLabel = `Review ${ticker}`;
      onPrimary = () => onReviewPosition?.(ticker);
    }
  } else if (action.startsWith('INVEST_CASH:')) {
    const raw = action.slice('INVEST_CASH:'.length).trim();
    const amount = Number(raw);
    if (Number.isFinite(amount) && amount > 0) {
      primaryLabel = `Invest $${amount.toLocaleString()}`;
      onPrimary = () => onInvestCash?.(amount);
    }
  }

  if (!primaryLabel || !onPrimary) return null;

  const primaryStyle: React.CSSProperties = {
    background: '#22d3ee',
    color: '#0b1220',
    border: 'none',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '12.5px',
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };

  // Secondary text link (Download) — no background, subtle underline.
  const linkStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: '#22d3ee',
    padding: '7px 4px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    opacity: disabled ? 0.6 : 1,
  };

  // "Remind in Nd" — lightweight text link replacing the old bordered Dismiss.
  const dismissStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    color: 'rgba(255,255,255,0.55)',
    padding: '7px 4px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <div style={flush
      ? { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }
      : { display: 'flex', gap: '8px', padding: '0 14px 10px', marginTop: '-2px', alignItems: 'center' }
    }>
      <button
        type="button"
        style={primaryStyle}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onPrimary?.();
        }}
      >
        {primaryLabel}
      </button>
      {downloadLabel && onDownloadLink && (
        <button
          type="button"
          style={linkStyle}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onDownloadLink?.();
          }}
        >
          {downloadLabel}
        </button>
      )}
      {showDismiss && (
        <button
          type="button"
          style={dismissStyle}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation();
            onDismiss?.();
          }}
        >
          Remind in 5d
        </button>
      )}
    </div>
  );
}
