'use client';
// ─── InlineTradeButton — Renders BUY/SELL buttons next to AI stock mentions ───
// Detects **BUY TICKER** / **SELL TICKER** markers in AI responses.
// Opens TradeTicket pre-filled on click.
// Gated: Demo + Gold only (Silver = no buttons).

import { useState, useCallback } from 'react';
import TradeTicket from '@/components/portfolio/TradeTicket';

// ── Extraction ───────────────────────────────────────────────

export interface Suggestion {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Whether this was explicitly marked (true) or detected via heuristic (false) */
  explicit: boolean;
}

/** Common non-ticker uppercase words to exclude from heuristic detection */
const TICKER_BLACKLIST = new Set([
  'ETF', 'IPO', 'SPAC', 'CEO', 'CFO', 'COO', 'CTO', 'GDP', 'CPI', 'PPI',
  'FOMC', 'SEC', 'FDIC', 'IRS', 'USA', 'USD', 'EUR', 'GBP', 'JPY', 'CNY',
  'AI', 'PE', 'EPS', 'EBITDA', 'ROE', 'ROI', 'DCF', 'FCF', 'YOY', 'QOQ',
  'PT', 'TP', 'SL', 'ATH', 'ATL', 'YTD', 'MTD', 'MoM', 'Q', 'E', 'P', 'S',
  'BUY', 'SELL', 'HOLD', 'ALL', 'ANY', 'NEW', 'OLD', 'TOP', 'BOTTOM',
  'NASDAQ', 'NYSE', 'CBOE', 'SPX', 'NDX', 'RUT', 'VIX', 'DJIA',
  'TLDR', 'OK', 'FYI', 'BTW', 'IMO', 'IMHO', 'NFA', 'DYOR', 'DD',
  'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'HKD', 'SGD',
]);

/** Primary: extract explicitly marked suggestions from **BUY/SYMBOL** and **SELL/SYMBOL** */
export function extractExplicitSuggestions(markdownContent: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Match **BUY TICKER** or **SELL TICKER**
  const buyPattern = /\*\*BUY\s+([A-Z]{1,5}(?:\.[A-Z])?)\*\*/g;
  const sellPattern = /\*\*SELL\s+([A-Z]{1,5}(?:\.[A-Z])?)\*\*/g;

  for (const match of markdownContent.matchAll(buyPattern)) {
    const symbol = match[1].toUpperCase();
    const key = `${symbol}:BUY`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ symbol, side: 'BUY', explicit: true });
    }
  }
  for (const match of markdownContent.matchAll(sellPattern)) {
    const symbol = match[1].toUpperCase();
    const key = `${symbol}:SELL`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ symbol, side: 'SELL', explicit: true });
    }
  }

  return suggestions;
}

/** Fallback: heuristic scan for tickers near buy/sell language (sentence-aware) */
export function extractHeuristicSuggestions(
  markdownContent: string,
  holdingsSymbols: string[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Split into sentences
  const sentences = markdownContent.split(/(?<=[.!?])\s+/);

  // Action phrases that indicate a buy/accumulate recommendation
  const buyPhrases = [
    /(?:buy|add|start|initiate|accumulate|pick\s*up|get\s*into|load\s*up\s*on|go\s*long|open\s*a\s*position\s*in)\s+([A-Z]{1,5}(?:\.[A-Z])?)/gi,
    /(?:consider|recommend|suggest|worth\s*looking\s*at|look\s*at|check\s*out|I'd?\s*(?:go\s*with|pick|choose|grab))\s+([A-Z]{1,5}(?:\.[A-Z])?)/gi,
  ];

  const sellPhrases = [
    /(?:sell|trim|exit|reduce|dump|unload|get\s*out\s*of|cash\s*out\s*of|close\s*out)\s+([A-Z]{1,5}(?:\.[A-Z])?)/gi,
  ];

  for (const sentence of sentences) {
    for (const pattern of buyPhrases) {
      for (const match of sentence.matchAll(pattern)) {
        const symbol = match[1].toUpperCase();
        if (TICKER_BLACKLIST.has(symbol)) continue;
        const key = `${symbol}:BUY`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({ symbol, side: 'BUY', explicit: false });
        }
      }
    }
    for (const pattern of sellPhrases) {
      for (const match of sentence.matchAll(pattern)) {
        const symbol = match[1].toUpperCase();
        if (TICKER_BLACKLIST.has(symbol)) continue;
        // Heuristic sell only makes sense if user holds it
        if (!holdingsSymbols.includes(symbol)) continue;
        const key = `${symbol}:SELL`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({ symbol, side: 'SELL', explicit: false });
        }
      }
    }
  }

  return suggestions;
}

/** Merge explicit + heuristic, deduplicate, prefer explicit over heuristic */
export function parseSuggestions(
  markdownContent: string,
  holdingsSymbols: string[],
  userAskedTickers: string[],
): Suggestion[] {
  // 1. Extract explicit markers (primary, most reliable)
  const explicit = extractExplicitSuggestions(markdownContent);
  const result: Suggestion[] = [...explicit];
  const seen = new Set(explicit.map(s => `${s.symbol}:${s.side}`));

  // 2. Add user-asked tickers if AI didn't explicitly mark them
  // (handles deviation: user asked about SNDK, AI recommended MSFT instead)
  for (const ticker of userAskedTickers) {
    const key = `${ticker}:BUY`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ symbol: ticker, side: 'BUY', explicit: false });
    }
  }

  // 3. Fallback heuristic (only if no explicit markers found at all)
  if (explicit.length === 0) {
    const heuristic = extractHeuristicSuggestions(markdownContent, holdingsSymbols);
    for (const s of heuristic) {
      const key = `${s.symbol}:${s.side}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(s);
      }
    }
  }

  return result;
}

// ── Component ────────────────────────────────────────────────

interface InlineTradeButtonProps {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Tier check — pass false for Silver to hide buttons */
  enabled: boolean;
  /** Callback to open TradeTicket */
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
  /** Whether this is a "less confident" heuristic detection (subtler styling) */
  dimmed?: boolean;
}

export function InlineTradeButton({
  symbol, side, enabled, onTrade, dimmed,
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
        opacity: dimmed ? 0.7 : 1,
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
          dimmed={!s.explicit}
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
  }) => Promise<void>;
}

export function ChatTradeTicket(props: ChatTradeTicketProps) {
  return <TradeTicket {...props} />;
}
