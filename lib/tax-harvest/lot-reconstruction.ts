// ═══════════════════════════════════════════════════════════════
// lib/tax-harvest/lot-reconstruction.ts
// ═══════════════════════════════════════════════════════════════
//
// Reconstruct REAL tax lots from brokerage ACTIVITIES
// (SnapTrade `/accounts/{id}/activities`), replacing the synthetic
// `position_lots` ledger as the primary source of acquisition data.
//
// Position lots built from "current holdings − today's average cost" are
// fabrications: they invent a single acquisition date and price for shares
// that may have been bought across years. Activities are the broker's own
// record of what actually traded, so replaying them FIFO gives every share a
// real fill date and price.
//
// Honesty beats coverage here. When the activity window does not explain a
// position — shares were held before the window opened, or were sold with no
// matching buy on file — we DO NOT invent a lot. We report the gap as an
// "unknown start" so the UI can surface it instead of showing a fake number.
//
// Pure functions only — no DB, no fetch, no React. Unit-tested in
// tests/tax-harvest-lot-reconstruction.test.ts.

// ─── Public types ────────────────────────────────────────────

export type ActivityKind = 'buy' | 'sell' | 'other';

export interface ActivityRecord {
  id?: string | null;
  /** Raw ticker from the payload, any case. */
  symbol: string;
  /** e.g. 'BUY' | 'SELL' | 'DIVIDEND' | 'FEE' | 'WITHDRAWAL'. */
  type: string;
  /** Signed or unsigned; the magnitude is used. */
  units: number;
  price: number;
  /** ISO timestamp. */
  trade_date: string;
  amount?: number | null;
  description?: string | null;
  fee?: number | null;
}

export interface ReconstructedLot {
  /** Stable: `act:<activity.id>` when the activity has an id, else `act:<index>`. */
  id: string;
  /** Uppercased ticker. */
  ticker: string;
  /** Original acquired quantity (never reduced). */
  qty: number;
  /** Remaining after FIFO sells, >= 0. */
  remainingQty: number;
  priceAtFill: number;
  /** The activity's real trade_date, ISO. */
  filledAt: string;
  activityId: string | null;
}

export interface UnknownStartInfo {
  ticker: string;
  /** Live qty NOT explained by window activities (>= 0). */
  sharesHeldBeforeWindow: number;
  /** Units sold inside the window with no matching buy on file (>= 0). */
  oversoldUnits: number;
  /** Earliest activity date ON FILE for this ticker. */
  earliestActivityDate: string | null;
  /** Earliest activity date ON FILE for the whole account. */
  windowStartDate: string | null;
  label: string;
}

export interface ReconstructOptions {
  /** Live broker shares per symbol. */
  positionQtyByTicker?: Record<string, number> | null;
  /** Default 1e-4. */
  toleranceShares?: number;
}

export interface ReconstructionResult {
  /** Only lots with remainingQty > tolerance. */
  lotsByTicker: Record<string, ReconstructedLot[]>;
  /** Every reconstructed lot, incl. fully consumed (audit). */
  allLotsByTicker: Record<string, ReconstructedLot[]>;
  unknownStartByTicker: Record<string, UnknownStartInfo>;
  activityCount: number;
  windowStartDate: string | null;
  windowEndDate: string | null;
}

// ─── Constants ───────────────────────────────────────────────

const DEFAULT_TOLERANCE = 1e-4;

const BUY_TYPES = new Set([
  'BUY',
  'BUY_TO_COVER',
  'REINVEST',
  'REINVESTMENT',
  'BUY_TO_OPEN',
]);

const SELL_TYPES = new Set(['SELL', 'SELL_SHORT', 'SELL_TO_CLOSE']);

// ─── Numeric / date hygiene ──────────────────────────────────

/**
 * Coerce arbitrary payload junk to a finite number, or `null`.
 * Strings are trimmed and thousands separators stripped. Booleans are NOT
 * meaningful quantities here, so they yield `null`.
 */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const n = Number(trimmed.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Round to `dp` decimals, killing float-replay noise. */
function roundTo(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Parse a date-ish value to epoch ms, or `null` if unparseable. */
function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : null;
}

/** ISO-8601 UTC string for an epoch ms value. */
function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/** `YYYY-MM-DD` in UTC for a date-ish value, or `null`. */
function utcDay(value: string | null): string | null {
  const ms = parseDateMs(value);
  if (ms === null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

// ─── Type classification ─────────────────────────────────────

function normalizeTypeString(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/_+/g, '_');
}

/**
 * Classify a raw broker activity type into buy / sell / other.
 *
 * Only buys and sells move shares; dividends, fees, withdrawals, journals,
 * splits, taxes, etc. are `'other'` and never create lots.
 */
export function classifyActivityType(raw: string | null | undefined): ActivityKind {
  if (typeof raw !== 'string') return 'other';
  const normalized = normalizeTypeString(raw);
  if (!normalized) return 'other';
  if (BUY_TYPES.has(normalized)) return 'buy';
  if (SELL_TYPES.has(normalized)) return 'sell';
  return 'other';
}

// ─── Label ───────────────────────────────────────────────────

const EM_DASH = '\u2014';

/**
 * Em-approved human label for an unknown start. Pass the most specific date
 * available (the ticker's own earliest activity, else the account window).
 */
export function unknownStartLabel(windowStartDate: string | null): string {
  const day = utcDay(windowStartDate);
  if (day) return `Unknown start ${EM_DASH} acquired before ${day} on file`;
  return `Unknown start ${EM_DASH} acquired before the earliest record on file`;
}

// ─── Positions payload → live qty map ────────────────────────

function readPositionTicker(symbol: unknown): string | null {
  if (typeof symbol === 'string') {
    const trimmed = symbol.trim();
    return trimmed ? trimmed.toUpperCase() : null;
  }
  if (symbol && typeof symbol === 'object') {
    const obj = symbol as Record<string, unknown>;
    for (const key of ['symbol', 'raw_symbol', 'description'] as const) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) return v.trim().toUpperCase();
    }
  }
  return null;
}

/**
 * Map a raw SnapTrade positions payload to `{ [UPPERCASE_SYMBOL]: units }`.
 * Duplicate symbols are summed; rows with no ticker are skipped; cash-equivalent
 * rows with zero units are ignored.
 */
export function positionQtyFromPositions(
  positions: ReadonlyArray<unknown> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(positions)) return out;

  for (const raw of positions) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;

    const ticker = readPositionTicker(p.symbol);
    if (!ticker) continue;

    const units = toNumber(p.units ?? p.fractional_units) ?? 0;

    // Cash sweeps (e.g. money-market) are not a taxable equity position.
    if (p.cash_equivalent === true && units === 0) continue;

    out[ticker] = roundTo((out[ticker] ?? 0) + units, 9);
  }

  return out;
}

// ─── Internal replay shapes ──────────────────────────────────

interface PreparedRecord {
  index: number;
  ticker: string;
  kind: ActivityKind;
  id: string | null;
  units: number;
  price: number;
  filledAt: string;
  ms: number;
}

interface TickerDates {
  earliestMs: number | null;
}

function buildLotId(activityId: string | null, index: number): string {
  return activityId !== null && activityId !== '' ? `act:${activityId}` : `act:${index}`;
}

function normalizeActivityId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

// ─── Core: reconstruct lots from activities ──────────────────

/**
 * Replay brokerage activities FIFO into real tax lots, per ticker.
 *
 * Buys open lots in chronological order; each sell consumes the oldest lot
 * with remaining quantity first. Sells with no matching on-file buy do not
 * throw — their unmatched units are tracked as `oversoldUnits` so the gap can
 * be surfaced. Ties on identical timestamps keep their ORIGINAL INPUT ORDER
 * (SnapTrade returns newest-first, so we never reverse equal-timestamp rows):
 * partial fills sharing a second stay distinct, deterministic lots.
 */
export function reconstructLotsFromActivities(
  activities: Array<ActivityRecord> | null | undefined,
  options?: ReconstructOptions,
): ReconstructionResult {
  const tol = toNumber(options?.toleranceShares) ?? DEFAULT_TOLERANCE;

  // Even with no activities on file, held positions must still be flagged as
  // unknown-start — so we never bail out early; we just replay an empty list.
  const list: ReadonlyArray<unknown> = Array.isArray(activities) ? activities : [];

  const replay: PreparedRecord[] = [];
  const tickerDates = new Map<string, TickerDates>();
  let activityCount = 0;
  let windowMinMs: number | null = null;
  let windowMaxMs: number | null = null;

  for (let index = 0; index < list.length; index += 1) {
    const raw = list[index];
    if (!raw || typeof raw !== 'object') continue;
    activityCount += 1;

    const rec = raw as Partial<ActivityRecord>;

    // A date is required for a record to be placed on the timeline at all.
    const ms = parseDateMs(rec.trade_date);
    if (ms === null) continue;

    // The account window is defined by EVERY on-file activity date, of any
    // type — a dividend or fee still proves the account existed then.
    if (windowMinMs === null || ms < windowMinMs) windowMinMs = ms;
    if (windowMaxMs === null || ms > windowMaxMs) windowMaxMs = ms;

    const tickerRaw = typeof rec.symbol === 'string' ? rec.symbol.trim().toUpperCase() : '';
    if (!tickerRaw) continue;

    const existing = tickerDates.get(tickerRaw);
    if (!existing) {
      tickerDates.set(tickerRaw, { earliestMs: ms });
    } else if (existing.earliestMs === null || ms < existing.earliestMs) {
      existing.earliestMs = ms;
    }

    const kind = classifyActivityType(rec.type);
    if (kind === 'other') continue;

    const units = toNumber(rec.units);
    const price = toNumber(rec.price);
    // Non-positive units/price are dropped; a buy at price 0 is NOT free.
    if (units === null || Math.abs(units) <= 0) continue;
    if (price === null || price <= 0) continue;

    replay.push({
      index,
      ticker: tickerRaw,
      kind,
      id: normalizeActivityId(rec.id),
      units: Math.abs(units),
      price,
      filledAt: String(rec.trade_date),
      ms,
    });
  }

  // Stable ascending sort by date. Array.prototype.sort is stable (ES2019+),
  // so equal timestamps keep original input order — no reversal.
  replay.sort((a, b) => a.ms - b.ms);

  const lotsByTickerRaw = new Map<string, ReconstructedLot[]>();
  const oversoldUnits = new Map<string, number>();

  for (const entry of replay) {
    if (entry.kind === 'buy') {
      const lot: ReconstructedLot = {
        id: buildLotId(entry.id, entry.index),
        ticker: entry.ticker,
        qty: entry.units,
        remainingQty: entry.units,
        priceAtFill: entry.price,
        filledAt: entry.filledAt,
        activityId: entry.id,
      };
      const list = lotsByTickerRaw.get(entry.ticker);
      if (list) list.push(lot);
      else lotsByTickerRaw.set(entry.ticker, [lot]);
      continue;
    }

    // SELL — consume oldest remaining lots first.
    const list = lotsByTickerRaw.get(entry.ticker) ?? [];
    let remaining = entry.units;
    for (const lot of list) {
      if (remaining <= tol) break;
      if (lot.remainingQty <= tol) continue;
      const take = Math.min(remaining, lot.remainingQty);
      lot.remainingQty = roundTo(lot.remainingQty - take, 9);
      if (lot.remainingQty < 0) lot.remainingQty = 0;
      remaining = roundTo(remaining - take, 9);
    }
    if (remaining > tol) {
      oversoldUnits.set(entry.ticker, roundTo((oversoldUnits.get(entry.ticker) ?? 0) + remaining, 9));
    }
  }

  const allLotsByTicker: Record<string, ReconstructedLot[]> = {};
  const lotsByTicker: Record<string, ReconstructedLot[]> = {};
  for (const [ticker, lots] of lotsByTickerRaw) {
    allLotsByTicker[ticker] = lots.map((l) => ({ ...l }));
    const open = lots.filter((l) => l.remainingQty > tol).map((l) => ({ ...l }));
    if (open.length > 0) lotsByTicker[ticker] = open;
  }

  const windowStartDate = windowMinMs === null ? null : toIsoUtc(windowMinMs);
  const windowEndDate = windowMaxMs === null ? null : toIsoUtc(windowMaxMs);

  // ── Unknown-start detection ──
  const positionQty = normalizePositionMap(options?.positionQtyByTicker);
  const unknownStartByTicker: Record<string, UnknownStartInfo> = {};

  for (const [ticker, liveQty] of Object.entries(positionQty)) {
    const lots = lotsByTickerRaw.get(ticker) ?? [];
    const reconstructedRemaining = roundTo(
      lots.reduce((sum, l) => sum + l.remainingQty, 0),
      9,
    );
    const sharesHeldBeforeWindow = roundTo(Math.max(0, liveQty - reconstructedRemaining), 6);
    const oversold = roundTo(oversoldUnits.get(ticker) ?? 0, 6);

    const zeroOnFileBuys = lots.length === 0;
    const qualifies =
      sharesHeldBeforeWindow > tol || oversold > tol || (liveQty > 0 && zeroOnFileBuys);

    // Fully explained (no oversell, every live share has a lot) → no gap.
    const fullyExplained = reconstructedRemaining >= liveQty - tol && oversold <= tol;
    if (!qualifies || fullyExplained) continue;

    const earliestMs = tickerDates.get(ticker)?.earliestMs ?? null;
    const earliestActivityDate = earliestMs === null ? null : toIsoUtc(earliestMs);

    unknownStartByTicker[ticker] = {
      ticker,
      sharesHeldBeforeWindow,
      oversoldUnits: oversold,
      earliestActivityDate,
      windowStartDate,
      label: unknownStartLabel(earliestActivityDate ?? windowStartDate),
    };
  }

  return {
    lotsByTicker,
    allLotsByTicker,
    unknownStartByTicker,
    activityCount,
    windowStartDate,
    windowEndDate,
  };
}

/** Uppercase + merge duplicate keys of a live-qty map. */
function normalizePositionMap(
  input: Record<string, number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const ticker = typeof key === 'string' ? key.trim().toUpperCase() : '';
    if (!ticker) continue;
    const qty = toNumber(value);
    if (qty === null) continue;
    out[ticker] = roundTo((out[ticker] ?? 0) + qty, 9);
  }
  return out;
}
