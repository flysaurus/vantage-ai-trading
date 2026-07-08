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

/** Recommendation language patterns — sentences matching these are scanned for ALL tickers */
const RECOMMENDATION_SIGNALS = [
  /\b(?:buy|sell|add|start|initiate|accumulate|pick\s*up|get\s*into|load\s*up|go\s*long|open\s*a\s*position|trim(?:ming)?|exit|reduce|lighten|pare\s*(?:back|down)|cut\s*(?:loose|back))\b/i,
  /\b(?:consider|recommend|suggest|worth\s*(?:looking|a\s*look)|look\s*(?:at|into)|check\s*out)\b/i,
  /\b(?:instead|rather|better\s*(?:off|bet|play|choice)|prefer(?:able)?|alternative|swap|switch)\b/i,
  /\b(?:go\s*with|pick|choose|grab|try|put\s*money\s*(?:in|into)|allocate|deploy)\b/i,
  /\b(?:opportunity|upside|entry\s*point|good\s*(?:time|price|level|entry))\b/i,
  /\b(?:skip|avoid|stay\s*away|pass\s*on|steer\s*clear)\b/i,
];

/** Common non-ticker words that match [A-Z]{1,5} but are never stock symbols */
const TICKER_BLACKLIST = new Set([
  'ETF', 'IPO', 'SPAC', 'CEO', 'CFO', 'COO', 'CTO', 'GDP', 'CPI', 'PPI',
  'FOMC', 'SEC', 'FDIC', 'IRS', 'USA', 'USD', 'EUR', 'GBP', 'JPY', 'CNY',
  'AI', 'PE', 'EPS', 'EBITDA', 'ROE', 'ROI', 'DCF', 'FCF', 'YOY', 'QOQ',
  'PT', 'TP', 'SL', 'ATH', 'ATL', 'YTD', 'MTD', 'MoM', 'Q', 'E', 'P', 'S',
  'BUY', 'SELL', 'HOLD', 'ALL', 'ANY', 'NEW', 'OLD', 'TOP', 'BOTTOM',
  'NASDAQ', 'NYSE', 'CBOE', 'SPX', 'NDX', 'RUT', 'VIX', 'DJIA',
  'TLDR', 'OK', 'FYI', 'BTW', 'IMO', 'IMHO', 'NFA', 'DYOR', 'DD',
  'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'HKD', 'SGD',
  'DONT', 'WONT', 'CANT', 'ISNT', 'ARENT', 'WASNT', 'HAVE', 'BEEN', 'WERE',
  'THE', 'AND', 'FOR', 'BUT', 'NOT', 'YOU', 'YOUR', 'FROM', 'WITH', 'THAT',
  'THIS', 'THAN', 'THEM', 'THEY', 'MUCH', 'MORE', 'LESS', 'LIKE', 'JUST',
  'ALSO', 'WELL', 'VERY', 'EVEN', 'ONLY', 'BACK', 'DOWN', 'INTO', 'OVER',
  'WILL', 'CAN', 'MAY', 'GET', 'SEE', 'NOW', 'ONE', 'TWO', 'BIG', 'LOW',
  'HIGH', 'LONG', 'SHORT', 'CALL', 'PUT', 'TRIM', 'CASH', 'HALF', 'FULL',
  'MAKE', 'MADE', 'TAKE', 'TOOK', 'KNOW', 'THINK', 'MEAN', 'LOOK', 'FEEL',
  'I', 'A', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF', 'IN',
  'IS', 'IT', 'ME', 'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO', 'UP', 'US',
  'WE', 'AM', 'PM', 'MR', 'MS', 'DR', 'VS', 'EX', 'OH', 'AH', 'HA',
]);

/** Extract all uppercase tickers from text (1-5 chars, optional .X suffix) */
function extractTickers(text: string): string[] {
  const tickers: string[] = [];
  const seen = new Set<string>();
  const pattern = /\b([A-Z]{1,5}(?:\.[A-Z])?)\b/g;
  for (const m of text.matchAll(pattern)) {
    const t = m[1].toUpperCase();
    if (!TICKER_BLACKLIST.has(t) && !seen.has(t)) {
      seen.add(t);
      tickers.push(t);
    }
  }
  return tickers;
}

/** Check if a sentence contains recommendation/action language */
function isRecommendationSentence(sentence: string): boolean {
  return RECOMMENDATION_SIGNALS.some(p => p.test(sentence));
}

/** Fallback heuristic: sentence-level ticker extraction from recommendation sentences */
export function extractHeuristicSuggestions(
  markdownContent: string,
  holdingsSymbols: string[],
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const seen = new Set<string>();

  // Strip markdown bold/italic for cleaner text matching
  const cleanText = markdownContent.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');

  // Split into sentences (also handle bullet points)
  const sentences = cleanText.split(/(?<=[.!?])\s+|\n/);

  // Sell-specific patterns (require holdings check)
  const sellSignals = /\b(?:sell|trim(?:ming)?|exit|reduce|dump|unload|get\s*out|cash\s*out|close\s*out|cut\s*loose|lighten|pare\s*(?:back|down))\b/i;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed || trimmed.length < 5) continue;

    if (isRecommendationSentence(trimmed)) {
      const tickers = extractTickers(trimmed);
      const hasSellSignal = sellSignals.test(trimmed);

      for (const symbol of tickers) {
        // Only mark as SELL if the ticker appears near sell language (within ~30 chars)
        // This prevents: "trim AAPL, buy MSFT" → MSFT wrongly marked SELL
        let side: 'BUY' | 'SELL' = 'BUY';
        if (hasSellSignal && holdingsSymbols.includes(symbol)) {
          // Find the ticker position and check if a sell word is nearby
          const tickerIdx = trimmed.toUpperCase().indexOf(symbol);
          if (tickerIdx >= 0) {
            const context = trimmed.slice(Math.max(0, tickerIdx - 25), tickerIdx + symbol.length + 25);
            if (sellSignals.test(context)) {
              side = 'SELL';
            }
          }
        }

        const key = `${symbol}:${side}`;
        if (!seen.has(key)) {
          seen.add(key);
          suggestions.push({ symbol, side, explicit: false });
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
  // 1. Extract explicit markers (**BUY TICKER** / **SELL TICKER**)
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

  // 3. ALWAYS run heuristic (was previously skipped when explicit markers existed)
  // This catches tickers mentioned in recommendation sentences but not explicitly marked.
  // Example: AI writes **BUY MSFT** but mentions NVDA without the marker → heuristic catches NVDA.
  const heuristic = extractHeuristicSuggestions(markdownContent, holdingsSymbols);
  for (const s of heuristic) {
    const key = `${s.symbol}:${s.side}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(s);
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
