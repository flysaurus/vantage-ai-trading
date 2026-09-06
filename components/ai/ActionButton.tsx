'use client';

import React from 'react';

// ─── ActionButton — inline CTA for AI Noticed cards ──────────────
// Renders below a noticed card's copy. The action string is emitted
// DETERMINISTICALLY by the rules engine (never free-text LLM parsing):
//   'REBALANCE'                 → concentration-risk / allocation drift
//   'REVIEW_POSITION:<TICKER>'  → single-position flag
//   'INVEST_CASH:<amount>'      → idle-cash suggestion (dollar amount)
// Primary CTA uses the existing cyan-fill token; secondary "Dismiss"
// reuses the existing snooze flow unchanged.

interface ActionButtonProps {
  action: string;
  onRebalance?: () => void;
  onReviewPosition?: (ticker: string) => void;
  onInvestCash?: (amount: number) => void;
  onDismiss?: () => void;
  disabled?: boolean;
}

export default function ActionButton({
  action,
  onRebalance,
  onReviewPosition,
  onInvestCash,
  onDismiss,
  disabled = false,
}: ActionButtonProps) {
  let primaryLabel = '';
  let onPrimary: (() => void) | undefined;

  if (action === 'REBALANCE') {
    primaryLabel = 'Rebalance';
    onPrimary = onRebalance;
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

  const dismissStyle: React.CSSProperties = {
    background: 'transparent',
    color: 'rgba(255,255,255,0.65)',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '8px',
    padding: '7px 14px',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
    opacity: disabled ? 0.6 : 1,
  };

  return (
    <div style={{ display: 'flex', gap: '8px', padding: '0 14px 10px', marginTop: '-2px' }}>
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
      <button
        type="button"
        style={dismissStyle}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss?.();
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
