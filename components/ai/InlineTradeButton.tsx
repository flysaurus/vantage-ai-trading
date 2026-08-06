'use client';
// ─── InlineTradeButton — Renders BUY/SELL buttons next to AI stock mentions ───
// DETECTION: [RECOMMEND:SYMBOL:BUY] / [RECOMMEND:SYMBOL:SELL] markers ONLY.
//   → Claude emits these structured markers when making genuine recommendations.
//   → No heuristic/word-proximity fallback — markers are the sole detection mechanism.
//   → This eliminates false positives on common words that happen to be valid tickers
//     (e.g. "AI" meaning artificial intelligence, not C3.ai stock; "A" as article).
// VALIDATION: All marker suggestions are validated against a cached Set of real
//   US stock symbols loaded from Finnhub on mount (catches hallucinated tickers).

import { useState, useCallback, useEffect } from 'react';
import TradeTicket from '@/components/portfolio/TradeTicket';
import { useAccounts } from '@/context/AccountContext';

// ── Extraction ───────────────────────────────────────────────

export interface Suggestion {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Pre-populated share count if user specified one (e.g. "buy 10 shares") */
  suggestedShares?: number;
  /** Pre-populated dollar amount if user specified one (e.g. "buy $500 worth") */
  suggestedAmount?: number;
}

// ─── Disambiguation: multiple ticker candidates ────────────────
// When resolveSymbol returns multiple matches, the model emits
// [RECOMMEND_CHOICE:CompanyName:BUY/SELL] + a JSON block with candidates.
export interface ChoiceCandidate {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface ChoiceSuggestion {
  companyName: string;
  side: 'BUY' | 'SELL';
  candidates: ChoiceCandidate[];
}

// ─── PRIMARY: Structured marker detection ─────────────────────
// Matches: [RECOMMEND:SYMBOL:BUY/SELL] — single confident match
// Matches: [RECOMMEND:SYMBOL:BUY/SELL:10] — with share count
// Matches: [RECOMMEND:SYMBOL:BUY/SELL:$500] — with dollar amount
// Matches: [RECOMMEND_CHOICE:CompanyName:BUY/SELL] — multiple candidates
// Exchange suffix (.DE, .MX, etc.) is captured but stripped — only base US symbol is used.
// These are stripped from visible text by AITab's rendering layer.

const MARKER_PATTERN = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):(BUY|SELL)(?::(\$?[\d,]+(?:\.\d+)?))?\]/g;
const CHOICE_MARKER_PATTERN = /\[RECOMMEND_CHOICE:(.+?):(BUY|SELL)\]/g;

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
    const rawSymbol = match[1].toUpperCase();
    const side = match[2] as 'BUY' | 'SELL';
    const quantityStr = match[3] || '';

    // ── Exchange suffix stripping ──
    // Multi-char suffixes (.DE, .MX, .SW, .LN, .PA etc.) = foreign exchange listing → strip
    // Single-char suffixes: only .A and .B are legitimate US share classes (BRK.A, BRK.B)
    // All other single-char suffixes (.F, .X, .Y etc.) are foreign exchange → strip
    const dotIdx = rawSymbol.lastIndexOf('.');
    const suffix = dotIdx >= 0 ? rawSymbol.slice(dotIdx + 1) : '';
    const validSingleCharSuffixes = new Set(['A', 'B']);
    const symbol = (suffix.length >= 2 || (suffix.length === 1 && !validSingleCharSuffixes.has(suffix.toUpperCase())))
      ? rawSymbol.slice(0, dotIdx)
      : rawSymbol;
    if (symbol !== rawSymbol && process.env.NODE_ENV !== 'production') {
      console.log('[parseSuggestions] Stripped exchange suffix:', rawSymbol, '→', symbol);
    }

    // Parse optional quantity: "10" = shares, "$500" = dollar amount
    let suggestedShares: number | undefined;
    let suggestedAmount: number | undefined;
    if (quantityStr) {
      if (quantityStr.startsWith('$')) {
        suggestedAmount = parseFloat(quantityStr.slice(1).replace(/,/g, ''));
      } else {
        suggestedShares = parseFloat(quantityStr.replace(/,/g, ''));
      }
    }

    // Validate against real ticker list if available (catches hallucinated symbols)
    if (validSymbols && validSymbols.size > 0 && !validSymbols.has(symbol)) {
      console.log('[parseSuggestions] FILTERED OUT:', symbol, '(not in validSymbols set of', validSymbols.size, 'symbols)');
      continue;
    }

    const key = `${symbol}:${side}`;
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ symbol, side, suggestedShares, suggestedAmount });
    }
  }

  return suggestions;
}

/**
 * Extract choice suggestions from [RECOMMEND_CHOICE:CompanyName:BUY/SELL] markers
 * and their adjacent JSON candidate blocks.
 *
 * Expected format:
 *   [RECOMMEND_CHOICE:SK Hynix:BUY]
 *   ```json
 *   {"candidates":[{"symbol":"SKHYV","name":"SK hynix Inc.","exchange":"OTC","type":"ADR"}]}
 *   ```
 */
export function parseChoiceSuggestions(markdownContent: string): ChoiceSuggestion[] {
  const results: ChoiceSuggestion[] = [];
  CHOICE_MARKER_PATTERN.lastIndex = 0;

  for (const match of markdownContent.matchAll(CHOICE_MARKER_PATTERN)) {
    const companyName = match[1].trim();
    const side = match[2] as 'BUY' | 'SELL';
    const markerEnd = match.index! + match[0].length;

    // Look for the JSON block immediately after this marker
    const afterMarker = markdownContent.slice(markerEnd, markerEnd + 5000);
    const jsonBlockMatch = afterMarker.match(/```json\s*\n?([\s\S]*?)```/);

    if (!jsonBlockMatch) continue;

    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (parsed.candidates && Array.isArray(parsed.candidates) && parsed.candidates.length > 0) {
        results.push({
          companyName,
          side,
          candidates: parsed.candidates.map((c: any) => ({
            symbol: c.symbol || '',
            name: c.name || '',
            exchange: c.exchange || '',
            type: c.type || '',
          })),
        });
      }
    } catch {
      // Invalid JSON — skip this marker
    }
  }

  return results;
}

/**
 * Extract the TL;DR summary from [SUMMARY_TLDR:...] marker.
 * Returns null if no marker found.
 */
export function parseSummaryTLDR(markdownContent: string): string | null {
  const match = markdownContent.match(/\[SUMMARY_TLDR:(.+?)\]/);
  return match ? match[1].trim() : null;
}

/** Strip [CLARIFY:{...}] markers with bracket counting — handles nested JSON arrays
 *  that the old regex /\[CLARIFY:[^\]]*\]/ would truncate at the first inner ]. */
function stripClarifyMarkers(text: string): string {
  let result = text;
  const prefix = '[CLARIFY:{';
  let idx = 0;
  while ((idx = result.indexOf(prefix, idx)) !== -1) {
    // Walk forward counting { and } to find the matching close-brace of the JSON object
    let depth = 1; // the opening { of the JSON object
    let pos = idx + prefix.length;
    while (pos < result.length && depth > 0) {
      if (result[pos] === '{') depth++;
      else if (result[pos] === '}') depth--;
      pos++;
    }
    // Skip optional whitespace/newline to the closing ]
    while (pos < result.length && (result[pos] === ' ' || result[pos] === '\n')) pos++;
    if (pos < result.length && result[pos] === ']') pos++;
    // Remove the entire [CLARIFY:{...}] span
    result = result.slice(0, idx) + result.slice(pos);
    // Don't advance idx — we removed content before the current position
  }
  return result;
}

/** Strip [PORTFOLIO:{...}] blocks with bracket counting — same technique as stripClarifyMarkers. */
function stripPortfolioMarkers(text: string): string {
  let result = text;
  const prefix = '[PORTFOLIO:{';
  let idx = 0;
  while ((idx = result.indexOf(prefix, idx)) !== -1) {
    let depth = 1;
    let pos = idx + prefix.length;
    while (pos < result.length && depth > 0) {
      if (result[pos] === '{') depth++;
      else if (result[pos] === '}') depth--;
      pos++;
    }
    while (pos < result.length && (result[pos] === ' ' || result[pos] === '\n')) pos++;
    if (pos < result.length && result[pos] === ']') pos++;
    result = result.slice(0, idx) + result.slice(pos);
  }
  return result;
}

/** Strip [RECOMMEND:...] and [RECOMMEND_CHOICE:...] markers + JSON blocks from visible text — users never see raw markers. */
export function stripRecommendationMarkers(text: string): string {
  let result = stripPortfolioMarkers(stripClarifyMarkers(text))
    .replace(MARKER_PATTERN, '')
    .replace(CHOICE_MARKER_PATTERN, '')
    .replace(/\[SUMMARY_TLDR:.+?\]\s*/g, '')  // Remove TL;DR marker from visible text
    .replace(/\[CLARIFY:[^\n]*/g, '')  // Fallback: strip any remaining CLARIFY fragments not caught by bracket counter
    // Remove JSON candidate blocks that follow choice markers
    .replace(/```json\s*\n?\{[\s\S]*?"candidates"[\s\S]*?\}\s*\n?```/g, '')
    .replace(/\s+,/g, ',')  // fix "MSFT , NVDA" → "MSFT, NVDA"
    .replace(/\s+\./g, '.')  // fix trailing space before period
    .replace(/[ \t]{2,}/g, ' ')  // collapse multiple horizontal spaces (preserve \n for tables)
    .replace(/\n{3,}/g, '\n\n')  // collapse excessive blank lines
    .trim();
  return result;
}

// ── Component ────────────────────────────────────────────────

/**
 * Mark a trade as executed — stores the marker key in localStorage
 * so all InlineTradeButton instances reflect the greyed-out state.
 * Call this from the TradeTicket onConfirm handler after a real order submission.
 */
/**
 * Check if a symbol/side combination has been marked as executed
 * in localStorage. Returns trade data if found, null otherwise.
 * Survives page reloads.
 */
export function isMarkerExecutedInStorage(
  symbol: string,
  side: 'BUY' | 'SELL',
): { shares: number; amount: number; side: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('vantage_executed_markers');
    if (!raw) return null;
    const data = JSON.parse(raw);
    const key = `${symbol}:${side}`;
    return data[key] || null;
  } catch {
    return null;
  }
}

/**
 * Persist trade execution data to localStorage so buttons stay greyed
 * across sessions and page reloads.
 */
export function markMarkerExecuted(
  symbol: string,
  side: 'BUY' | 'SELL',
  shares: number,
  amount: number,
): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('vantage_executed_markers');
    const data: Record<string, { shares: number; amount: number; side: string }> =
      raw ? JSON.parse(raw) : {};
    const key = `${symbol}:${side}`;
    data[key] = { shares, amount, side };
    localStorage.setItem('vantage_executed_markers', JSON.stringify(data));
  } catch { /* degrade silently */ }
}

interface InlineTradeButtonProps {
  symbol: string;
  side: 'BUY' | 'SELL';
  /** Pre-populated share count (from user's message) */
  suggestedShares?: number;
  /** Pre-populated dollar amount (from user's message) */
  suggestedAmount?: number;
  /** Tier check — pass false for Silver to hide buttons */
  enabled: boolean;
  /** Callback to open TradeTicket */
  onTrade: (symbol: string, side: 'BUY' | 'SELL', suggestedShares?: number, suggestedAmount?: number) => void;
  /** If previously executed, the real fill data — renders permanent "✓ Bought" state */
  executed?: { shares: number; amount: number } | null;
}

export function InlineTradeButton({
  symbol, side, suggestedShares, suggestedAmount, enabled, onTrade, executed,
}: InlineTradeButtonProps) {
  const [tapped, setTapped] = useState(false);
  const { activeAccount } = useAccounts();
  const isReadOnly = activeAccount && !activeAccount.isDemo && !activeAccount.tradingEnabled;

  // ── Persistent executed-state check ──
  // After a real trade submission, the marker stays greyed out with a ✓
  // Survives page reloads via localStorage, persists across chat history
  // Supports both old format (Set → JSON array) and new format (Record → JSON object)
  const [isExecuted, setIsExecuted] = useState(() => isMarkerExecutedInStorage(symbol, side) !== null);

  // Listen for cross-component execution events (when TradeTicket confirms an order)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'vantage_executed_markers' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          const key = `${symbol}:${side}`;
          // New format: object with keys
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data[key]) setIsExecuted(true);
          } else if (Array.isArray(data)) {
            // Old format: array of strings
            if (data.includes(key)) setIsExecuted(true);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [symbol, side]);

  const handleClick = useCallback(() => {
    if (!enabled || executed || isExecuted || isReadOnly) return;
    setTapped(true);
    onTrade(symbol, side, suggestedShares, suggestedAmount);
    setTimeout(() => setTapped(false), 600);
  }, [enabled, executed, isExecuted, isReadOnly, symbol, side, suggestedShares, suggestedAmount, onTrade]);

  if (!enabled) return null;

  // ── Executed state: show permanent confirmation, no click action ──
  if (executed) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(16,185,129,0.06)',
          border: '1px solid rgba(16,185,129,0.15)',
          borderRadius: '6px',
          color: '#10b981',
          fontSize: '11px',
          fontWeight: 700,
          padding: '3px 8px',
          fontFamily: 'inherit',
          letterSpacing: '0.03em',
          opacity: 1,
          textDecoration: 'none',
        }}
      >
        <span style={{ fontSize: '10px' }}>☑️</span>
        {' '}{symbol} ${executed.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    );
  }

  // ── Read-only broker: disabled buy button ──
  if (isReadOnly) {
    return (
      <button
        disabled
        title={`Trading not available — ${activeAccount.broker} is read-only`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: 'rgba(100,116,139,0.06)',
          border: '1px solid rgba(100,116,139,0.15)',
          borderRadius: '6px',
          color: '#64748b',
          fontSize: '11px',
          fontWeight: 600,
          padding: '3px 8px',
          cursor: 'not-allowed',
          fontFamily: 'inherit',
          opacity: 0.5,
        }}
      >
        <span style={{ fontSize: '10px' }}>🔒</span>
        Read-only broker
      </button>
    );
  }

  const isBuy = side === 'BUY';
  const effectiveExecuted = !!(executed || isExecuted);
  const color = effectiveExecuted ? '#475569' : isBuy ? '#10b981' : '#ef4444';
  const bg = effectiveExecuted
    ? 'rgba(71,85,105,0.08)'
    : isBuy ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)';
  const border = effectiveExecuted
    ? 'rgba(71,85,105,0.2)'
    : isBuy ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';

  return (
    <button
      onClick={handleClick}
      disabled={tapped || effectiveExecuted}
      title={effectiveExecuted ? 'Order already submitted' : `${side} ${symbol}`}
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
        cursor: effectiveExecuted ? 'default' : enabled ? 'pointer' : 'default',
        fontFamily: 'inherit',
        transition: 'all 0.15s ease',
        letterSpacing: '0.03em',
        opacity: effectiveExecuted ? 0.5 : 1,
        textDecoration: effectiveExecuted ? 'line-through' : 'none',
      }}
    >
      <span style={{ fontSize: '10px' }}>
        {effectiveExecuted ? '✅' : isBuy ? '💰' : '📤'}
      </span>
      {effectiveExecuted ? `${side} ${symbol}` : `${isBuy ? 'BUY' : 'SELL'} ${symbol}`}
    </button>
  );
}

// ── Button row wrapper ───────────────────────────────────────

interface InlineTradeButtonsProps {
  suggestions: Suggestion[];
  choiceSuggestions?: ChoiceSuggestion[];
  enabled: boolean;
  onTrade: (symbol: string, side: 'BUY' | 'SELL', suggestedShares?: number, suggestedAmount?: number) => void;
  /** Map of "symbol" → execution data for this message's buttons */
  executedMap?: Record<string, { shares: number; amount: number; side: string }>;
}

export function InlineTradeButtons({ suggestions, choiceSuggestions, enabled, onTrade, executedMap }: InlineTradeButtonsProps) {
  if (!enabled) return null;
  if (suggestions.length === 0 && (!choiceSuggestions || choiceSuggestions.length === 0)) return null;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      marginTop: '8px',
      paddingTop: '6px',
    }}>
      {choiceSuggestions && choiceSuggestions.length > 0 && choiceSuggestions.map((cs, i) => (
        <DisambiguationPicker key={`choice-${i}`} suggestion={cs} onTrade={onTrade} />
      ))}
      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {suggestions.map((s) => (
            <InlineTradeButton
              key={`${s.symbol}:${s.side}`}
              symbol={s.symbol}
              side={s.side}
              suggestedShares={s.suggestedShares}
              suggestedAmount={s.suggestedAmount}
              enabled={enabled}
              onTrade={onTrade}
              executed={executedMap?.[s.symbol] || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Disambiguation picker ────────────────────────────────────

interface DisambiguationPickerProps {
  suggestion: ChoiceSuggestion;
  onTrade: (symbol: string, side: 'BUY' | 'SELL', suggestedShares?: number, suggestedAmount?: number) => void;
}

function DisambiguationPicker({ suggestion, onTrade }: DisambiguationPickerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);
  const isBuy = suggestion.side === 'BUY';

  const handleSelect = useCallback((symbol: string) => {
    setSelected(symbol);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!selected) return;
    setTapped(true);
    onTrade(selected, suggestion.side);
    setTimeout(() => setTapped(false), 600);
  }, [selected, suggestion.side, onTrade]);

  if (suggestion.candidates.length === 0) return null;

  return (
    <div style={{
      background: 'rgba(14,22,36,0.8)',
      border: '1px solid rgba(34,211,238,0.2)',
      borderRadius: '8px',
      padding: '12px',
      fontSize: '12px',
    }}>
      <div style={{
        color: '#94a3b8',
        marginBottom: '8px',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.03em',
      }}>
        ⚡ Multiple tickers found for <strong style={{ color: '#e2e8f0' }}>{suggestion.companyName}</strong> — pick one:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
        {suggestion.candidates.map((c) => (
          <button
            key={c.symbol}
            onClick={() => handleSelect(c.symbol)}
            disabled={tapped}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              background: selected === c.symbol
                ? (isBuy ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.12)')
                : 'rgba(30,41,59,0.5)',
              border: `1px solid ${selected === c.symbol
                ? (isBuy ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.35)')
                : 'rgba(71,85,105,0.2)'}`,
              borderRadius: '6px',
              cursor: tapped ? 'default' : 'pointer',
              color: '#e2e8f0',
              fontSize: '11px',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              textAlign: 'left',
            }}
          >
            <div>
              <span style={{ fontWeight: 700, fontSize: '12px', letterSpacing: '0.03em' }}>{c.symbol}</span>
              <span style={{ color: '#64748b', marginLeft: '8px' }}>{c.name}</span>
            </div>
            <span style={{
              color: '#475569',
              fontSize: '10px',
              background: 'rgba(71,85,105,0.15)',
              padding: '2px 6px',
              borderRadius: '4px',
            }}>
              {c.exchange}{c.type ? ` · ${c.type}` : ''}
            </span>
          </button>
        ))}
      </div>
      <button
        onClick={handleConfirm}
        disabled={!selected || tapped}
        style={{
          width: '100%',
          padding: '6px 12px',
          background: selected
            ? (isBuy ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.18)')
            : 'rgba(71,85,105,0.1)',
          border: `1px solid ${selected
            ? (isBuy ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.4)')
            : 'rgba(71,85,105,0.15)'}`,
          borderRadius: '6px',
          color: selected ? (isBuy ? '#10b981' : '#ef4444') : '#475569',
          fontSize: '11px',
          fontWeight: 700,
          cursor: selected && !tapped ? 'pointer' : 'default',
          fontFamily: 'inherit',
          transition: 'all 0.15s ease',
          letterSpacing: '0.03em',
        }}
      >
        {tapped ? '⏳ Opening…' : selected ? `${suggestion.side} ${selected}` : 'Select a ticker first'}
      </button>
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
  initialShares?: number;
  onConfirm: (params: {
    shares: number;
    type: 'market' | 'limit' | 'stop' | 'stop_limit';
    limitPrice?: number;
    stopPrice?: number;
    timeInForce?: 'day' | 'gtc' | 'ioc' | 'fok';
  }) => Promise<void>;
}

export function ChatTradeTicket(props: ChatTradeTicketProps) {
  return <TradeTicket {...props} />;
}
