'use client';
// ─── InlineTradeButton — Renders BUY/SELL buttons next to AI stock mentions ───
// PRIMARY DETECTION: [RECOMMEND:SYMBOL:BUY] / [RECOMMEND:SYMBOL:SELL] markers
//   → These are the system-prompt-instructed structured markers. Claude only emits
//     them when making genuine, unconditional recommendations. Zero false positives.
// FALLBACK: Heuristic sentence-level detection (for older cached responses without markers)
//   → Only fires if NO markers found. All candidates must pass real-ticker validation.
// VALIDATION: All candidates (marker + heuristic) are validated against a cached
//   Set of real US stock symbols loaded once from Finnhub on AITab mount.

import { useState, useCallback } from 'react';
import TradeTicket from '@/components/portfolio/TradeTicket';

// ── Extraction ───────────────────────────────────────────────

export interface Suggestion {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** How this was detected: 'marker' (primary, reliable), 'heuristic' (fallback, less reliable) */
  source: 'marker' | 'heuristic';
}

// ─── PRIMARY: Structured marker detection ─────────────────────
// Matches: [RECOMMEND:SYMBOL:BUY] or [RECOMMEND:SYMBOL:SELL]
// These are stripped from visible text by AITab's rendering layer.

const MARKER_PATTERN = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z])?):(BUY|SELL)\]/g;

/** Extract suggestions from [RECOMMEND:SYMBOL:BUY/SELL] markers (primary detection). */
export function extractMarkerSuggestions(markdownContent: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Reset lastIndex (regex with /g flag is stateful)
  MARKER_PATTERN.lastIndex = 0;

  for (const match of markdownContent.matchAll(MARKER_PATTERN)) {
    const symbol = match[1].toUpperCase();
    const side = match[2] as 'BUY' | 'SELL';
    const key = `${symbol}:${side}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ symbol, side, source: 'marker' });
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

// ─── FALLBACK: Heuristic sentence-level detection ──────────────
// Only used for responses that lack marker annotations (e.g. older cached responses).
// Requires real-ticker validation via validSymbols Set.

/** Recommendation language patterns — sentences matching these are scanned for ALL tickers */
const RECOMMENDATION_SIGNALS = [
  /\b(?:buy|sell|add|start|initiate|accumulate|pick\s*up|get\s*into|load\s*up|go\s*long|open\s*a\s*position|trim(?:ming)?|exit|reduce|lighten|pare\s*(?:back|down)|cut\s*(?:loose|back))\b/i,
  /\b(?:consider|recommend|suggest|worth\s*(?:looking|a\s*look)|look\s*(?:at|into)|check\s*out)\b/i,
  /\b(?:instead|rather|better\s*(?:off|bet|play|choice)|prefer(?:able)?|alternative|swap|switch)\b/i,
  /\b(?:go\s*with|pick|choose|grab|try|put\s*money\s*(?:in|into)|allocate|deploy)\b/i,
  /\b(?:opportunity|upside|entry\s*point|good\s*(?:time|price|level|entry))\b/i,
  /\b(?:skip|avoid|stay\s*away|pass\s*on|steer\s*clear)\b/i,
];

const SELL_SIGNALS = /\b(?:sell|trim(?:ming)?|exit|reduce|dump|unload|get\s*out|cash\s*out|close\s*out|cut\s*loose|lighten|pare\s*(?:back|down))\b/i;

/** Extract all potential tickers from text (uppercase 1-5 char words, with .X suffix support). */
function extractTickers(text: string): string[] {
  const tickers: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{1,5}(?:\.[A-Z])?)\b/g)) {
    const t = m[1].toUpperCase();
    if (!seen.has(t)) {
      seen.add(t);
      tickers.push(t);
    }
  }
  return tickers;
}

function isRecommendationSentence(sentence: string): boolean {
  return RECOMMENDATION_SIGNALS.some(p => p.test(sentence));
}

/** Fallback heuristic: sentence-level ticker extraction from recommendation sentences.
 *  Requires validSymbols (real ticker list) for filtering — no blacklist needed. */
export function extractHeuristicSuggestions(
  markdownContent: string,
  holdingsSymbols: string[],
  validSymbols?: Set<string> | null,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Strip markdown for cleaner text matching
  const cleanText = markdownContent
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');

  const sentences = cleanText.split(/(?<=[.!?])\s+|\n/);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.length < 5) continue;

    if (isRecommendationSentence(trimmed)) {
      const tickers = extractTickers(trimmed);
      const hasSellSignal = SELL_SIGNALS.test(trimmed);

      for (const symbol of tickers) {
        // Skip if we have a valid symbol set and this symbol isn't in it
        if (validSymbols && validSymbols.size > 0 && !validSymbols.has(symbol)) continue;

        // Proximity-based sell detection: ticker marked SELL only if a sell word
        // appears within 25 chars of it AND the user holds it
        let side: 'BUY' | 'SELL' = 'BUY';
        if (hasSellSignal && holdingsSymbols.includes(symbol)) {
          const tickerIdx = trimmed.toUpperCase().indexOf(symbol);
          if (tickerIdx >= 0) {
            const context = trimmed.slice(Math.max(0, tickerIdx - 25), tickerIdx + symbol.length + 25);
            if (SELL_SIGNALS.test(context)) {
              side = 'SELL';
            }
          }
        }

        const key = `${symbol}:${side}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({ symbol, side, source: 'heuristic' });
        }
      }
    }
  }

  return suggestions;
}

// ─── Combined parser ─────────────────────────────────────────

export interface ParseResult {
  suggestions: Suggestion[];
  /** Whether markers were found in the response (used to decide primary vs fallback) */
  hasMarkers: boolean;
}

/** Parse all suggestions from an AI response:
 *  1. Primary: [RECOMMEND:SYMBOL:BUY/SELL] markers (if present)
 *  2. Fallback: Heuristic detection (only if no markers found)
 *  3. Always: Validate against real ticker list (if validSymbols provided)
 *  4. Always: Include user-asked tickers as optional buttons
 */
export function parseSuggestions(
  markdownContent: string,
  holdingsSymbols: string[],
  userAskedTickers: string[],
  validSymbols?: Set<string> | null,
): ParseResult {
  const result: Suggestion[] = [];
  const seen = new Set<string>();

  // 1. PRIMARY: Structured markers
  const markers = extractMarkerSuggestions(markdownContent);
  const hasMarkers = markers.length > 0;

  for (const s of markers) {
    // Validate against real ticker list if available
    if (validSymbols && validSymbols.size > 0 && !validSymbols.has(s.symbol)) continue;
    const key = `${s.symbol}:${s.side}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(s);
    }
  }

  // 2. User-asked tickers (always include as optional, validates against real ticker list)
  for (const ticker of userAskedTickers) {
    const key = `${ticker}:BUY`;
    if (!seen.has(key)) {
      if (validSymbols && validSymbols.size > 0 && !validSymbols.has(ticker.toUpperCase())) continue;
      seen.add(key);
      result.push({ symbol: ticker.toUpperCase(), side: 'BUY', source: 'heuristic' });
    }
  }

  // 3. FALLBACK: Heuristic (only if no markers found — older cached responses)
  if (!hasMarkers) {
    const heuristic = extractHeuristicSuggestions(markdownContent, holdingsSymbols, validSymbols);
    for (const s of heuristic) {
      const key = `${s.symbol}:${s.side}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(s);
      }
    }
  }

  return { suggestions: result, hasMarkers };
}

// ── Component ────────────────────────────────────────────────

interface InlineTradeButtonProps {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Tier check — pass false for Silver to hide buttons */
  enabled: boolean;
  /** Callback to open TradeTicket */
  onTrade: (symbol: string, side: 'BUY' | 'SELL') => void;
  /** Whether this is a heuristic fallback detection (subtler styling) */
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
          dimmed={s.source === 'heuristic'}
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
