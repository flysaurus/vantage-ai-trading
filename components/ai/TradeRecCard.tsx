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
// card, so the trade-enabled ("Trade" + "Download plan") and read-only
// ("Download plan" only) behaviours stay identical across the app.
// The primary CTA names the actual trade ("Trim XLF") rather than a generic
// "Trade" — the recommendation is already parsed at this point.

interface Props {
  recs: TradeRec[];
  readOnly?: boolean;
  onRebalance: () => void;
  /**
   * Opens the multi-leg ORDER TICKET for these recs. When provided (and the
   * account is trade-enabled) this replaces the REBALANCE CTA — a specific
   * trade recommendation must open an order ticket, never the rebalance flow.
   */
  onTrade?: (recs: TradeRec[]) => void;
  onDownload?: () => void;
  onReviewPosition?: (ticker: string) => void;
  disabled?: boolean;
}

export function TradeRecCard({ recs, readOnly, onRebalance, onTrade, onDownload, onReviewPosition, disabled }: Props) {
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
          color: 'var(--v-chat-text-3)',
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
              color: r.side === 'trim' ? 'var(--v-accent-label)' : 'var(--v-gain-label)',
              minWidth: '34px',
            }}
          >
            {r.side === 'trim' ? 'TRIM' : 'BUY'}
          </span>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--v-chat-text)' }}>
            {r.ticker}
          </span>
          <span style={{ fontSize: '13px', color: 'var(--v-chat-text-3)', flex: 1, minWidth: 0 }}>
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
                color: 'var(--v-accent-label)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Review →
            </button>
          )}
        </div>
      ))}

      {/* Real execution controls.
          Specific trade recs → ORDER TICKET (onTrade). The REBALANCE CTA is a
          fallback for callers that don't supply a ticket; read-only accounts
          keep the download-only control. */}
      {onTrade && !readOnly ? (
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            data-testid="trade-rec-trade"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onTrade(recs);
            }}
            style={{
              background: 'var(--v-accent-button)',
              color: 'var(--v-accent-text)',
              border: 'none',
              borderRadius: '8px',
              padding: '7px 14px',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {recs.length === 1
              ? `${recs[0].side === 'trim' ? 'Trim' : 'Buy'} ${recs[0].ticker}`
              : `Trade ${recs.length} legs`}
          </button>
          {onDownload && (
            <button
              type="button"
              data-testid="trade-rec-download"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onDownload();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--v-accent-label)',
                padding: '7px 4px',
                fontSize: '12.5px',
                fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              Download plan
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '10px' }}>
          <ActionButton
            action="REBALANCE"
            flush
            showDismiss={false}
            readOnly={readOnly}
            disabled={disabled}
            // Read-only: ActionButton's primary IS the download control, so it
            // must run the real .xlsx export — not the rebalance flow.
            onRebalance={readOnly ? (onDownload || onRebalance) : onRebalance}
            onDownload={onDownload || onRebalance}
          />
        </div>
      )}

      <div style={{ fontSize: '11px', color: 'var(--v-chat-text-3)', marginTop: '6px' }}>
        {formatTradeRec(recs[0])}
        {recs.length > 1 ? ` +${recs.length - 1} more` : ''} — review before you execute.
      </div>
    </div>
  );
}

export default TradeRecCard;
