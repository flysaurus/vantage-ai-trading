'use client';

import React from 'react';

export interface PositionRowData {
  symbol: string;
  qty: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  currentPrice: number;
  sector?: string;
}

interface PositionRowProps {
  position: PositionRowData;
  onSell?: () => void;
  showBasketBadge?: boolean;
  basketName?: string;
  isSelectable?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  /** If true, treat as compact list item (no checkbox, no sell button) */
  compact?: boolean;
  /** Day change display */
  dayChange?: number;
  dayChangePercent?: number;
  totalPnl?: number;
  totalPnlPercent?: number;
  avgCost?: number;
  portfolioPercent?: number;
}

export function PositionRow({
  position,
  onSell,
  showBasketBadge,
  basketName,
  isSelectable,
  isSelected,
  onSelect,
  compact,
  dayChange,
  dayChangePercent,
  totalPnl,
  totalPnlPercent,
}: PositionRowProps) {
  const pnl = totalPnl ?? position.unrealizedPnL;
  const pnlPct = totalPnlPercent ?? position.unrealizedPnLPercent;
  const isUp = pnl >= 0;

  return (
    <div
      className={`position-row ${isSelectable ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={isSelectable && onSelect ? onSelect : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {/* Left side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isSelectable && (
            <div className={`select-circle ${isSelected ? 'checked' : ''}`}>
              {isSelected && <span style={{ fontSize: 10, lineHeight: 1 }}>✓</span>}
            </div>
          )}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>
                {position.symbol}
              </span>
              {basketName && (
                <span className="basket-badge">{basketName}</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>
              {position.qty} shares{position.sector ? ` · ${position.sector}` : ''}
            </div>
          </div>
        </div>

        {/* Right side */}
        <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>
              ${position.marketValue.toLocaleString()}
            </div>
            <div style={{ fontSize: 10, fontWeight: 600, color: isUp ? '#22c55e' : '#ef4444' }}>
              {isUp ? '+' : ''}${Math.round(Math.abs(pnl)).toLocaleString()} ({isUp ? '+' : ''}{pnlPct.toFixed(1)}%)
            </div>
          </div>
          {onSell && !isSelectable && !compact && (
            <button
              onClick={(e) => { e.stopPropagation(); onSell(); }}
              className="sell-single-btn"
            >
              Sell
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .position-row {
          padding: 10px 12px;
          background: #0f172a;
          border-radius: 8px;
          margin-bottom: 6px;
        }
        .position-row.selectable {
          cursor: pointer;
        }
        .position-row.selected {
          border: 1px solid #06b6d4;
          background: rgba(6,182,212,0.06);
        }
        .select-circle {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          border: 2px solid #334155;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          color: #06b6d4;
          font-weight: 700;
          font-size: 11px;
          transition: all 0.15s;
        }
        .select-circle.checked {
          border-color: #06b6d4;
          background: rgba(6,182,212,0.15);
        }
        .basket-badge {
          font-size: 9px;
          font-weight: 600;
          padding: 1px 6px;
          border-radius: 10px;
          background: rgba(6,182,212,0.15);
          color: #06b6d4;
          white-space: nowrap;
        }
        .sell-single-btn {
          padding: 3px 10px;
          font-size: 10px;
          font-weight: 700;
          background: rgba(239,68,68,0.12);
          border: 1px solid rgba(239,68,68,0.25);
          border-radius: 6px;
          color: #f87171;
          cursor: pointer;
          font-family: inherit;
          white-space: nowrap;
        }
      `}</style>
    </div>
  );
}
