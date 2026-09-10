// ─── Structured trade recommendations ────────────────────────────────────────
// SAFETY / CONSISTENCY REQUIREMENT: when a chat response contains a specific,
// actionable trade recommendation (an exact share count or an exact dollar
// amount to trim/buy), it must NOT be left as freeform prose with no structured
// action attached. It renders as a card with real Trade / Download controls —
// the same `ActionButton` pattern the concentration-risk hero card uses.
//
// This module is the detector. It is deliberately CONSERVATIVE:
//   • a concrete quantity (share count or dollar amount) is REQUIRED
//   • the quantity must sit in the same sentence as a trade verb and a ticker
//   • questions are ignored ("should I trim SPY by $5,000?" is not a rec)
//   • hedged/educational phrasing is ignored ("if you were to sell 10 shares…")
// False negatives are fine (prose stays prose). False positives are not: we only
// surface a card when both a ticker and an exact quantity are present.

export type TradeSide = 'trim' | 'buy';

export interface TradeRec {
  ticker: string;
  side: TradeSide;
  /** Exact share count when the model stated one. */
  shares?: number;
  /** Exact dollar amount when the model stated one. */
  amount?: number;
  /** The sentence the recommendation came from (for the "why" line). */
  note: string;
}

const TRIM_VERBS = /\b(trim|trims|trimming|reduce|reduces|reducing|cut|cuts|cutting|sell|sells|selling|exit|exiting|close|closing|lighten|lightening|pare|paring|scale\s+back)\b/i;
const BUY_VERBS = /\b(buy|buys|buying|add|adds|adding|increase|increases|increasing|purchase|purchasing|initiate|initiating|accumulate|accumulating|top\s+up)\b/i;

/** Uppercase tokens that look like tickers but are never tickers. */
const TICKER_STOPLIST = new Set([
  'I', 'A', 'AN', 'AND', 'OR', 'IF', 'THE', 'YOU', 'YOUR', 'IT', 'IS', 'ARE', 'WAS',
  'TO', 'OF', 'IN', 'ON', 'AT', 'BY', 'FOR', 'SO', 'NO', 'OK', 'DO', 'BE', 'WE',
  'USD', 'ETF', 'ETFS', 'IRA', 'ROTH', 'APR', 'EPS', 'PE', 'PEG', 'CEO', 'CFO',
  'AI', 'ML', 'API', 'CD', 'TD', 'YTD', 'YOY', 'QOQ', 'EOD', 'EOW', 'EOM', 'ATH',
  'P', 'L', 'G', 'S', 'B', 'C', 'D', 'E', 'F', 'H', 'J', 'K', 'M', 'N', 'R', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'TLDR', 'TL', 'DR', 'PM', 'AM', 'EST', 'EDT',
  'NOT', 'BUT', 'ALL', 'ANY', 'ONE', 'TWO', 'NEW', 'OLD', 'MAX', 'MIN', 'LOW',
  'HIGH', 'RISK', 'CASH', 'BUY', 'SELL', 'TRIM', 'HOLD', 'TOTAL', 'EACH', 'PLUS',
  'FUND', 'STOCK', 'STOCKS', 'MONEY', 'PLAN', 'YEAR', 'MONTH', 'WEEK', 'TODAY',
]);

/** Hedged / hypothetical lead-ins that mean "this is not a recommendation". */
const HEDGE = /(?:^|\b)(if you (?:were|had|would)|for example|hypothetically|as an example|in theory|one option|you could (?:also )?(?:consider)?)\b/i;

function sentences(text: string): string[] {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A quantity mention with its position in the sentence. */
interface QtyHit { idx: number; end: number; shares?: number; amount?: number }

function quantitiesIn(sentence: string): QtyHit[] {
  const hits: QtyHit[] = [];
  const reShares = /\b(\d[\d,]*)\s*(?:shares?|units?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = reShares.exec(sentence))) {
    hits.push({ idx: m.index, end: m.index + m[0].length, shares: Number(m[1].replace(/,/g, '')) });
  }
  const reAmt = /\$\s?(\d[\d,]*(?:\.\d+)?)/g;
  while ((m = reAmt.exec(sentence))) {
    hits.push({ idx: m.index, end: m.index + m[0].length, amount: Number(m[1].replace(/,/g, '')) });
  }
  const reUsd = /\b(\d[\d,]*(?:\.\d+)?)\s*(?:dollars|usd)\b/gi;
  while ((m = reUsd.exec(sentence))) {
    hits.push({ idx: m.index, end: m.index + m[0].length, amount: Number(m[1].replace(/,/g, '')) });
  }
  // Merge duplicates (e.g. "$12,450" matched twice) and keep left-to-right.
  const merged: QtyHit[] = [];
  for (const h of hits.sort((a, b) => a.idx - b.idx)) {
    const prev = merged[merged.length - 1];
    if (prev && prev.idx === h.idx) {
      prev.shares = prev.shares ?? h.shares;
      prev.amount = prev.amount ?? h.amount;
      prev.end = Math.max(prev.end, h.end);
      continue;
    }
    merged.push({ ...h });
  }
  return merged;
}

/** Positions of ticker mentions in a sentence, with index + end. */
function tickerHits(sentence: string): Array<{ ticker: string; idx: number; end: number }> {
  const out: Array<{ ticker: string; idx: number; end: number }> = [];
  const re = /(?:\$)?\b([A-Z]{2,5})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const t = m[1];
    if (TICKER_STOPLIST.has(t)) continue;
    out.push({ ticker: t, idx: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Split a sentence into trade clauses ("trim 18 shares of SPY" / "add 31 shares
 * of VTI") so each quantity is bound to the ticker it actually belongs to.
 * The comma guard avoids splitting inside numbers like "$12,450".
 */
function clauses(sentence: string): string[] {
  return sentence
    .split(/\s+and\s+then\s+|\s*\bthen\b\s*|\s+and\s+|;\s*|,\s*(?=[A-Za-z$])/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * Extract concrete, actionable trade recommendations from an assistant reply.
 * Returns [] when nothing is specific enough to act on.
 */
export function detectTradeRecommendations(text: string, max = 6): TradeRec[] {
  if (!text) return [];
  const found: TradeRec[] = [];
  const seen = new Map<string, TradeRec>();

  for (const s of sentences(text)) {
    if (s.trim().endsWith('?')) continue;          // a question is not a rec
    if (HEDGE.test(s)) continue;                   // hypothetical, not a rec
    if (!TRIM_VERBS.test(s) && !BUY_VERBS.test(s)) continue;

    let carrySide: TradeSide | null = null;
    let carryQty: QtyHit | null = null;

    for (const c of clauses(s)) {
      const qtyHits = quantitiesIn(c);
      const tHits = tickerHits(c);
      if (tHits.length === 0) continue;

      const sideHere: TradeSide | null = TRIM_VERBS.test(c) ? 'trim' : (BUY_VERBS.test(c) ? 'buy' : null);
      // A bare "…and QQQ" trails the previous clause's side/quantity.
      const side: TradeSide = sideHere || carrySide || (TRIM_VERBS.test(s) ? 'trim' : 'buy');
      const qtys = qtyHits.length > 0 ? qtyHits : (carryQty ? [carryQty] : []);
      if (qtys.length === 0) continue;
      if (qtyHits.length > 0) { carryQty = qtyHits[qtyHits.length - 1]; carrySide = side; }

      // Order-based pairing: quantity i belongs to ticker i. Repeats ("18 shares
      // of SPY ($12,450)") merge onto the SAME row rather than being dropped.
      const n = Math.max(qtys.length, tHits.length);
      for (let i = 0; i < n; i++) {
        const t = tHits[Math.min(i, tHits.length - 1)];
        const q = qtys[Math.min(i, qtys.length - 1)];
        const key = `${t.ticker}:${side}`;
        const existing = seen.get(key);
        if (existing) {
          if (existing.shares === undefined) existing.shares = q.shares;
          if (existing.amount === undefined) existing.amount = q.amount;
          continue;
        }
        const rec: TradeRec = {
          ticker: t.ticker,
          side,
          shares: q.shares,
          amount: q.amount,
          note: s.length > 200 ? `${s.slice(0, 197)}…` : s,
        };
        seen.set(key, rec);
        found.push(rec);
        if (found.length >= max) return found;
      }
    }
  }
  return found;
}

/** Human one-liner for a single recommendation, e.g. "Trim 18 shares of SPY". */
export function formatTradeRec(rec: TradeRec): string {
  const qty = rec.shares !== undefined
    ? `${rec.shares.toLocaleString()} share${rec.shares === 1 ? '' : 's'}`
    : `$${Math.round(rec.amount || 0).toLocaleString()}`;
  return rec.side === 'trim' ? `Trim ${qty} of ${rec.ticker}` : `Buy ${qty} of ${rec.ticker}`;
}
