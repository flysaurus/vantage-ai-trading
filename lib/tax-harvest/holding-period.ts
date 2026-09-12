// ═══════════════════════════════════════════════════════════════
// lib/tax-harvest/holding-period.ts — Short- vs long-term tax math
// ═══════════════════════════════════════════════════════════════
//
// The Tax Loss Harvesting page used to apply ONE flat rate to every
// harvestable dollar (a hardcoded 24% "short-term" assumption), which
// overstated the benefit on any position held more than a year.
//
// This module derives the holding period from the SHARES THEMSELVES — the
// existing FIFO lot ledger (`position_lots` → lib/fifo-engine.ts) — so the
// estimate follows the real acquisition date of every share:
//
//   • short-term (held ≤ 1 year)  → taxed at ordinary income rates
//   • long-term  (held > 1 year)  → taxed on the 0 / 15 / 20% ladder
//
// Shares with NO tracked lot are reported as UNKNOWN and are deliberately
// EXCLUDED from the estimate rather than run through an assumed rate. The UI
// must surface that bucket; silently approximating it is what produced the
// wrong numbers this replaces.
//
// Pure functions only — no DB, no fetch, no React. Unit-tested in
// tests/tax-harvest-holding-period.test.ts.

import { consumeLotsFIFO, type Lot } from '@/lib/fifo-engine';

// ─── Assumed rates (illustrative) ────────────────────────────
/** Assumed ordinary-income rate on short-term gains (illustrative). */
export const SHORT_TERM_ASSUMED_RATE = 0.24;
/** Long-term capital-gains ladder — the rate depends on taxable income. */
export const LONG_TERM_RATE_LADDER = [0, 0.15, 0.2] as const;
/** Middle rung of the ladder, used for the headline estimate. */
export const LONG_TERM_ASSUMED_RATE = 0.15;

export type HoldingPeriod = 'short' | 'long';
export type HoldingPeriodLabel = 'Short-term' | 'Long-term' | 'Mixed' | 'Unknown';

export interface TaxLot {
  id: string;
  qty: number;
  remainingQty: number;
  priceAtFill: number;
  filledAt: string;
}

export interface LotHoldingDetail {
  lotId: string;
  qty: number;
  priceAtFill: number;
  filledAt: string;
  holdingPeriod: HoldingPeriod;
  cost: number;
  marketValue: number;
  /** Negative = unrealized loss. */
  gain: number;
}

export interface PositionHoldingPerformance {
  symbol: string;
  qty: number;
  currentPrice: number;
  /** Shares covered by a tracked lot. */
  knownQty: number;
  /** Shares with no acquisition date on file. */
  unknownQty: number;
  shortTermQty: number;
  longTermQty: number;
  shortTermGain: number;
  longTermGain: number;
  /** Gain on shares whose holding period we cannot determine (avg-cost based). */
  unknownGain: number;
  /** Absolute $ of losses only (positive numbers), split by holding period. */
  shortTermLoss: number;
  longTermLoss: number;
  unknownLoss: number;
  /** Estimated tax benefit from the losses we CAN classify. */
  shortTermSavings: number;
  longTermSavings: number;
  estimatedSavings: number;
  effectiveRate: number | null;
  label: HoldingPeriodLabel;
  lots: LotHoldingDetail[];
}

export interface TaxEstimateSummary {
  /** All harvestable losses currently showing (absolute $). */
  totalLosses: number;
  shortTermLoss: number;
  longTermLoss: number;
  unknownLoss: number;
  shortTermSavings: number;
  longTermSavings: number;
  /** Savings from losses with a known holding period. */
  estimatedSavings: number;
  /** Positions with at least one tracked lot. */
  classifiedPositionCount: number;
  /** Positions with no acquisition date on file at all. */
  unclassifiedPositionCount: number;
  shortTermPositionCount: number;
  longTermPositionCount: number;
  mixedPositionCount: number;
}

// ─── Holding period of a single lot ──────────────────────────

/** Add whole calendar years, clamping Feb 29 → Feb 28. */
function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  const target = d.getFullYear() + years;
  const month = d.getMonth();
  const day = d.getDate();
  const out = new Date(d.getTime());
  out.setFullYear(target, month, day);
  // Feb 29 → Mar 1 roll-over guard
  if (out.getMonth() !== month) {
    out.setDate(0);
  }
  return out;
}

/**
 * Holding period for shares acquired at `filledAt`, measured at `asOf`.
 * Long-term requires holding for MORE than one year (IRS): exactly one year is
 * still short-term. Returns null when the acquisition date is unusable.
 */
export function holdingPeriodFor(filledAt: string | Date | null | undefined, asOf: Date = new Date()): HoldingPeriod | null {
  if (!filledAt) return null;
  const acquired = filledAt instanceof Date ? filledAt : new Date(filledAt);
  if (Number.isNaN(acquired.getTime())) return null;
  if (acquired.getTime() > asOf.getTime()) return null; // future-dated lot → not trustworthy
  return asOf.getTime() > addYears(acquired, 1).getTime() ? 'long' : 'short';
}

export function holdingPeriodLabel(period: HoldingPeriod | null): string {
  if (period === 'short') return 'Short-term (held ≤ 1 year)';
  if (period === 'long') return 'Long-term (held > 1 year)';
  return 'Holding period unknown';
}

/** Accepts DB rows (snake_case) or already-normalized lots (camelCase). */
export type TaxLotInput = Partial<Lot> & Partial<TaxLot> & { id?: string };

/** Normalize the DB lot rows into the shape this module consumes. */
export function toTaxLots(rows: Array<TaxLotInput> | null | undefined): TaxLot[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => !!r)
    .map(r => ({
      id: String(r.id ?? ''),
      qty: Number(r.qty) || 0,
      remainingQty: Number(r.remaining_qty ?? r.remainingQty ?? r.qty) || 0,
      priceAtFill: Number(r.price_at_fill ?? r.priceAtFill) || 0,
      filledAt: String(r.filled_at ?? r.filledAt ?? ''),
    }))
    .filter(l => l.remainingQty > 0 && l.priceAtFill > 0 && l.filledAt)
    .sort((a, b) => new Date(a.filledAt).getTime() - new Date(b.filledAt).getTime());
}

/**
 * Convert back to the canonical FIFO `Lot` shape so the shared TradeTicket can
 * render the same specific-lot disclosure the Portfolio sell flow shows.
 */
export function toFifoLots(lots: TaxLot[] | null | undefined, ticker: string): Lot[] {
  if (!Array.isArray(lots)) return [];
  return lots.map(l => ({
    id: l.id,
    ticker,
    qty: l.qty,
    remaining_qty: l.remainingQty,
    price_at_fill: l.priceAtFill,
    filled_at: l.filledAt,
    source: 'vantage',
  }));
}

// ─── Per-position breakdown ──────────────────────────────────

export interface PositionHoldingInput {
  symbol: string;
  qty: number;
  avgCost: number;
  currentPrice: number;
  marketValue?: number;
}

/**
 * Split a position's unrealized gain/loss by holding period.
 *
 * Shares are matched to lots FIFO (oldest first) — the same rule the sell
 * ledger and wash-sale checks use, so a harvest here consumes the same shares
 * the executor would.
 */
export function computePositionHoldingPeriod(
  input: PositionHoldingInput,
  lots: TaxLot[] = [],
  asOf: Date = new Date(),
  rates: { shortTerm?: number; longTerm?: number } = {},
): PositionHoldingPerformance {
  const shortRate = rates.shortTerm ?? SHORT_TERM_ASSUMED_RATE;
  const longRate = rates.longTerm ?? LONG_TERM_ASSUMED_RATE;

  const qty = Number(input.qty) || 0;
  const price = Number(input.currentPrice) || 0;
  const avgCost = Number(input.avgCost) || 0;
  const marketValue = Number(input.marketValue) || price * qty;

  const base: PositionHoldingPerformance = {
    symbol: input.symbol,
    qty,
    currentPrice: price,
    knownQty: 0,
    unknownQty: qty,
    shortTermQty: 0,
    longTermQty: 0,
    shortTermGain: 0,
    longTermGain: 0,
    unknownGain: marketValue - avgCost * qty,
    shortTermLoss: 0,
    longTermLoss: 0,
    unknownLoss: 0,
    shortTermSavings: 0,
    longTermSavings: 0,
    estimatedSavings: 0,
    effectiveRate: null,
    label: 'Unknown',
    lots: [],
  };

  if (qty <= 0) {
    return { ...base, unknownQty: 0, unknownGain: 0, label: 'Unknown' };
  }

  // Which lots back the shares we hold? FIFO order, oldest consumed first.
  let consumed: Array<{ lot: TaxLot; qty: number }> = [];
  const usable = (lots || []).filter(l => l.remainingQty > 0 && l.priceAtFill > 0);
  const available = usable.reduce((s, l) => s + l.remainingQty, 0);

  if (available > 0) {
    const take = Math.min(qty, available);
    const asEngineLots: Lot[] = usable.map(l => ({
      id: l.id,
      ticker: input.symbol,
      qty: l.qty || l.remainingQty,
      remaining_qty: l.remainingQty,
      price_at_fill: l.priceAtFill,
      filled_at: l.filledAt,
    }));
    try {
      const result = consumeLotsFIFO(asEngineLots, take);
      consumed = result.consumed.map(c => {
        const lot = usable.find(l => l.id === c.lot_id) as TaxLot;
        return { lot, qty: c.qty_consumed };
      }).filter(c => !!c.lot);
    } catch {
      // Engine refuses (shouldn't happen after the Math.min above) — fall back
      // to a plain oldest-first walk so the page still renders.
      let left = take;
      for (const l of usable) {
        if (left <= 0) break;
        const q = Math.min(l.remainingQty, left);
        left -= q;
        consumed.push({ lot: l, qty: q });
      }
    }
  }

  const details: LotHoldingDetail[] = [];
  let shortTermQty = 0;
  let longTermQty = 0;
  let shortTermGain = 0;
  let longTermGain = 0;

  for (const { lot, qty: lotQty } of consumed) {
    const period = holdingPeriodFor(lot.filledAt, asOf);
    // Untrustworthy acquisition date → treat those shares as unclassified.
    if (!period) continue;
    const cost = lot.priceAtFill * lotQty;
    const value = price * lotQty;
    const gain = value - cost;
    details.push({
      lotId: lot.id,
      qty: lotQty,
      priceAtFill: lot.priceAtFill,
      filledAt: lot.filledAt,
      holdingPeriod: period,
      cost,
      marketValue: value,
      gain,
    });
    if (period === 'short') {
      shortTermQty += lotQty;
      shortTermGain += gain;
    } else {
      longTermQty += lotQty;
      longTermGain += gain;
    }
  }

  const knownQty = shortTermQty + longTermQty;
  const unknownQty = Math.max(0, qty - knownQty);
  // Unknown shares still have a cost basis (the position's average cost) — we
  // know the dollar loss, just not the rate that applies to it.
  const unknownGain = unknownQty * (price - avgCost);

  const shortTermLoss = shortTermGain < 0 ? Math.abs(shortTermGain) : 0;
  const longTermLoss = longTermGain < 0 ? Math.abs(longTermGain) : 0;
  const unknownLoss = unknownGain < 0 ? Math.abs(unknownGain) : 0;

  const shortTermSavings = shortTermLoss * shortRate;
  const longTermSavings = longTermLoss * longRate;
  const estimatedSavings = shortTermSavings + longTermSavings;
  const classifiedLoss = shortTermLoss + longTermLoss;

  let label: HoldingPeriodLabel = 'Unknown';
  if (shortTermQty > 0 && longTermQty > 0) label = 'Mixed';
  else if (shortTermQty > 0 && unknownQty > 0) label = 'Mixed';
  else if (longTermQty > 0 && unknownQty > 0) label = 'Mixed';
  else if (shortTermQty > 0) label = 'Short-term';
  else if (longTermQty > 0) label = 'Long-term';

  return {
    symbol: input.symbol,
    qty,
    currentPrice: price,
    knownQty,
    unknownQty,
    shortTermQty,
    longTermQty,
    shortTermGain,
    longTermGain,
    unknownGain,
    shortTermLoss,
    longTermLoss,
    unknownLoss,
    shortTermSavings,
    longTermSavings,
    estimatedSavings,
    effectiveRate: classifiedLoss > 0 ? estimatedSavings / classifiedLoss : null,
    label,
    lots: details,
  };
}

// ─── Portfolio roll-up ───────────────────────────────────────

export function summarizeTaxEstimate(breakdowns: PositionHoldingPerformance[]): TaxEstimateSummary {
  const summary: TaxEstimateSummary = {
    totalLosses: 0,
    shortTermLoss: 0,
    longTermLoss: 0,
    unknownLoss: 0,
    shortTermSavings: 0,
    longTermSavings: 0,
    estimatedSavings: 0,
    classifiedPositionCount: 0,
    unclassifiedPositionCount: 0,
    shortTermPositionCount: 0,
    longTermPositionCount: 0,
    mixedPositionCount: 0,
  };

  for (const b of breakdowns) {
    summary.totalLosses += b.shortTermLoss + b.longTermLoss + b.unknownLoss;
    summary.shortTermLoss += b.shortTermLoss;
    summary.longTermLoss += b.longTermLoss;
    summary.unknownLoss += b.unknownLoss;
    summary.shortTermSavings += b.shortTermSavings;
    summary.longTermSavings += b.longTermSavings;
    summary.estimatedSavings += b.estimatedSavings;
    if (b.knownQty > 0) summary.classifiedPositionCount += 1;
    else summary.unclassifiedPositionCount += 1;
    if (b.label === 'Mixed') summary.mixedPositionCount += 1;
    else if (b.label === 'Short-term') summary.shortTermPositionCount += 1;
    else if (b.label === 'Long-term') summary.longTermPositionCount += 1;
  }

  return summary;
}

/**
 * Recurring-year projection: a slice of today's rate-corrected estimate,
 * standing in for the losses that typically appear across a full tax year.
 * Low = a quiet year (25%), high = an active year (50%).
 */
export function annualSavingsRange(estimatedSavings: number): { low: number; high: number } | null {
  if (!Number.isFinite(estimatedSavings) || estimatedSavings <= 0) return null;
  return { low: estimatedSavings * 0.25, high: estimatedSavings * 0.5 };
}

/** Human-readable rate note for the UI. */
export function rateBreakdownNote(): string {
  return `Short-term losses are estimated at an assumed ${Math.round(SHORT_TERM_ASSUMED_RATE * 100)}% ordinary-income rate; long-term losses at ${Math.round(LONG_TERM_ASSUMED_RATE * 100)}% (the 0 / 15 / 20% long-term ladder depends on your taxable income).`;
}

// ─── Illustrative fallback for undated positions ─────────────
//
// A position with no acquisition date on file cannot be classified, but it DOES
// have a real dollar loss. Reporting that bucket as "excluded" and letting the
// portfolio estimate collapse to $0.00 / 0.00% is worse than the flat-rate
// guess this feature replaced: it reads as "no tax benefit exists" rather than
// "we can't compute this precisely".
//
// So the undated bucket keeps a clearly-labelled ILLUSTRATIVE range — the
// long-term rate at the low end, the short-term rate at the high end — and is
// kept strictly separate from the per-position precise figure.

/** Low end of the illustrative assumption for undated losses (long-term rate). */
export const ILLUSTRATIVE_LOW_RATE = LONG_TERM_ASSUMED_RATE;
/** High end of the illustrative assumption for undated losses (short-term rate). */
export const ILLUSTRATIVE_HIGH_RATE = SHORT_TERM_ASSUMED_RATE;

/** Short label for anything driven by the general assumption rather than a real date. */
export const ILLUSTRATIVE_LABEL = 'General assumption — no purchase date on file';

export interface IllustrativeEstimate {
  /** Real losses (absolute $) on positions with no acquisition date. */
  loss: number;
  /** Low end of the illustrative savings range. */
  low: number;
  /** High end of the illustrative savings range. */
  high: number;
  /** How many positions are covered by the range. */
  positionCount: number;
  /** How many of those positions are currently harvestable. */
  symbols: string[];
}

/**
 * Illustrative savings range for every position we could not date.
 * Returns null when there is nothing undated (so the UI renders nothing extra).
 */
export function illustrativeEstimate(
  breakdowns: PositionHoldingPerformance[] | null | undefined,
): IllustrativeEstimate | null {
  const rows = Array.isArray(breakdowns) ? breakdowns : [];
  let loss = 0;
  let positionCount = 0;
  const symbols: string[] = [];
  for (const b of rows) {
    const unknownLoss = Number(b?.unknownLoss) || 0;
    if (unknownLoss <= 0) continue;
    loss += unknownLoss;
    positionCount += 1;
    if (b?.symbol) symbols.push(b.symbol);
  }
  if (loss <= 0) return null;
  return {
    loss,
    low: loss * ILLUSTRATIVE_LOW_RATE,
    high: loss * ILLUSTRATIVE_HIGH_RATE,
    positionCount,
    symbols,
  };
}

/**
 * One sentence explaining the illustrative range — used verbatim by the UI and
 * the .xlsx export so both say the same thing.
 */
export function illustrativeNote(est: IllustrativeEstimate | null): string {
  if (!est || est.loss <= 0) return '';
  const positions = `${est.positionCount} position${est.positionCount === 1 ? '' : 's'}`;
  return `${positions} ($${est.loss.toFixed(2)} of losses) have no purchase date on file — priced precisely would need the acquisition date, so they are held out of the precise figure and shown as an illustrative range instead (${Math.round(ILLUSTRATIVE_LOW_RATE * 100)}%–${Math.round(ILLUSTRATIVE_HIGH_RATE * 100)}% general assumption, not per-position accuracy).`;
}

/**
 * Headline savings for the page: the precise figure when we have one, otherwise
 * null so the caller can lead with the illustrative range rather than $0.00.
 */
export function headlineSavings(
  summary: Pick<TaxEstimateSummary, 'estimatedSavings'> | null | undefined,
): number | null {
  const precise = Number(summary?.estimatedSavings) || 0;
  return precise > 0 ? precise : null;
}
