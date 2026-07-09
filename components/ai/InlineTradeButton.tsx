'use client';
// ─── InlineTradeButton — Renders BUY/SELL buttons next to AI stock mentions ───
// DETECTION: [RECOMMEND:SYMBOL:BUY] / [RECOMMEND:SYMBOL:SELL] markers ONLY.
//   → Claude emits these structured markers when making genuine recommendations.
//   → No heuristic/word-proximity fallback — markers are the sole detection mechanism.
//   → This eliminates false positives on common words that happen to be valid tickers
//     (e.g. "AI" meaning artificial intelligence, not C3.ai stock; "A" as article).
// VALIDATION: All marker suggestions are validated against a cached Set of real
//   US stock symbols loaded from Finnhub on mount (catches hallucinated tickers).

import { useState, useCallback } from 'react';
import TradeTicket from '@/components/portfolio/TradeTicket';

// ── Extraction ───────────────────────────────────────────────

export interface Suggestion {
  symbol: string;
  side: 'BUY' | 'SELL';
}

// ─── PRIMARY: Structured marker detection ─────────────────────
// Matches: [RECOMMEND:SYMBOL:BUY] or [RECOMMEND:SYMBOL:SELL]
// These are stripped from visible text by AITab's rendering layer.

const MARKER_PATTERN = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z])?):(BUY|SELL)\]/g;

/**
 * Extract suggestions from [RECOMMEND:SYMBOL:BUY/SELL] markers.
 * Validates each against the real-ticker list if validSymbols is provided.
 */
export function parseSuggestions(
  markdownContent: string,
  validSymbols?: Set<string> | null,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Reset lastIndex (regex with /g flag is stateful)
  MARKER_PATTERN.lastIndex = 0;

  for (const match of markdownContent.matchAll(MARKER_PATTERN)) {
    const symbol = match[1].toUpperCase();
    const side = match[2] as 'BUY' | 'SELL';

    // Validate against real ticker list if available (catches hallucinated symbols)
    if (validSymbols && validSymbols.size > 0 && !validSymbols.has(symbol)) continue;

    const key = `${symbol}:${side}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ symbol, side });
    }
  }

  return suggestions;
}

/** Strip [RECOMMEND:...] markers from visible text — users never see raw markers. */
export function stripRecommendationMarkers(text: string): string {
  return text
    .replace(MARKER_PATTERN, '')
    .replace(/\s+,/g, ',')  // fix "MSFT , NVDA" → "MSFT, NVDA"
    .replace(/\s+\./g, '.')  // fix trailing space before period
    .replace(/\s{2,}/g, ' ')  // collapse multiple spaces
    .trim();
}

// ── Component ────────────────────────────────────────────────

interface InlineTradeButtonProps {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Tier check — pass false for Silver to hide buttons */
  enabled: boolean;
  /** Callback to open TradeTicket */
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
}

export function InlineTradeButton({
  symbol, side, enabled, onTrade,
}: InlineTradeButtonProps) {
  const [tapped, setTapped] = useState(false);

  const handleClick = useCallback(() => {
    if (!enabled) return;
    setTapped(true);
    onTrade(symbol, side);
    setTimeout(() => setTapped(false), 600);
  }, [enabled, symbol, side, onTrade]);

  if (!enabled) return null;

  const isBuy = side === 'BUY';
  const color = isBuy ? '#10b981' : '#ef4444';
  const bg = isBuy
    ? 'rgba(16,185,129,0.12)'
    : 'rgba(239,68,68,0.12)';
  const border = isBuy
    ? 'rgba(16,185,129,0.35)'
    : 'rgba(239,68,68,0.35)';

  return (
    <button
      onClick={handleClick}
      disabled={tapped}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        background: tapped ? 'rgba(34,211,238,0.18)' : bg,
        border: `1px solid ${tapped ? 'rgba(34,211,238,0.5)' : border}`,
        borderRadius: '6px',
        color: tapped ? '#22d3ee' : color,
        fontSize: '11px',
        fontWeight: 700,
        padding: '3px 8px',
        cursor: enabled ? 'pointer' : 'default',
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
        letterSpacing: '0.03em',
      }}
    >
      <span style={{ fontSize: '10px' }}>
        {isBuy ? '💰' : '📤'}
      </span>
      {isBuy ? 'BUY' : 'SELL'} {symbol}
    </button>
  );
}

// ── Button row wrapper ───────────────────────────────────────

interface InlineTradeButtonsProps {
  suggestions: Suggestion[];
  enabled: boolean;
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
}

export function InlineTradeButtons({ suggestions, enabled, onTrade }: InlineTradeButtonsProps) {
  if (!enabled || suggestions.length === 0) return null;

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '6px',
      marginTop: '8px',
      paddingTop: '6px',
    }}>
      {suggestions.map((s) => (
        <InlineTradeButton
          key={`${s.symbol}:${s.side}`}
          symbol={s.symbol}
          side={s.side}
          enabled={enabled}
          onTrade={onTrade}
        />
      ))}
    </div>
  );
}

// ── TradeTicket integration wrapper ──────────────────────────

interface ChatTradeTicketProps {
  isOpen: boolean;
  onClose: () => void;
  symbol: string;
  side: 'BUY' | 'SELL';
  currentPrice: number;
  sharesHeld: number;
  availableCash: number;
  onConfirm: (params: {
    shares: number;
    type: 'market' | 'limit';
    limitPrice?: number;
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  }) => Promise<void>;
}

export function ChatTradeTicket(props: ChatTradeTicketProps) {
  return <TradeTicket {...props} />;
}
