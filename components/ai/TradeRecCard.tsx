'use client';

import React from 'react';
import ActionButton from '@/components/ai/ActionButton';
import { TradeRec, formatTradeRec } from '@/lib/ai/trade-recs';

// ─── TradeRecCard ────────────────────────────────────────────────────────────
// Renders a chat reply's SPECIFIC trade recommendations as a structured card
// with real Trade / Download controls. Safety requirement: an actionable trade
// recommendation must never be left as prose with no structured action.
//
// Uses the exact same `ActionButton` pattern as the concentration-risk hero
// card, so the trade-enabled ("Trade" + "Download") and read-only ("Download")
// behaviours stay identical across the app.

interface Props {
  recs: TradeRec[];
  readOnly?: boolean;
  onRebalance: () => void;
  onDownload?: () => void;
  onReviewPosition?: (ticker: string) => void;
  disabled?: boolean;
}

export function TradeRecCard({ recs, readOnly, onRebalance, onDownload, onReviewPosition, disabled }: Props) {
  if (!recs || recs.length === 0) return null;

  return (
    <div
      data-testid="trade-rec-card"
      style={{
        marginTop: '12px',
        background: 'var(--v-chat-surface)',
        border: '1px solid var(--v-chat-border)',
        borderRadius: '16px',
        padding: '13px 14px 10px',
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          fontSize: '10.5px',
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--v-chat-text-4)',
          marginBottom: '8px',
        }}
      >
        Recommended trades
      </div>

      {recs.map((r) => (
        <div
          key={`${r.ticker}-${r.side}`}
          data-testid={`trade-rec-row-${r.ticker}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 0',
            borderTop: '1px solid var(--v-chat-border)',
          }}
        >
          <span
            style={{
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '0.03em',
              color: r.side === 'trim' ? 'var(--v-chat-accent)' : 'var(--v-gain)',
              minWidth: '34px',
            }}
          >
            {r.side === 'trim' ? 'TRIM' : 'BUY'}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v-chat-text)' }}>
            {r.ticker}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--v-chat-text-4)', flex: 1, minWidth: 0 }}>
            {r.shares !== undefined
              ? `${r.shares.toLocaleString()} share${r.shares === 1 ? '' : 's'}`
              : `$${Math.round(r.amount || 0).toLocaleString()}`}
          </span>
          {onReviewPosition && (
            <button
              data-testid={`trade-rec-review-${r.ticker}`}
              onClick={() => onReviewPosition(r.ticker)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: '12.5px',
                fontWeight: 600,
                color: 'var(--v-chat-accent)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Review →
            </button>
          )}
        </div>
      ))}

      {/* Real execution controls — identical to the hero card's action row */}
      <div style={{ marginTop: '10px' }}>
        <ActionButton
          action="REBALANCE"
          flush
          showDismiss={false}
          readOnly={readOnly}
          disabled={disabled}
          onRebalance={onRebalance}
          onDownload={onDownload || onRebalance}
        />
      </div>

      <div style={{ fontSize: '11px', color: 'var(--v-chat-text-5)', marginTop: '6px' }}>
        {formatTradeRec(recs[0])}
        {recs.length > 1 ? ` +${recs.length - 1} more` : ''} — review before you execute.
      </div>
    </div>
  );
}

export default TradeRecCard;
