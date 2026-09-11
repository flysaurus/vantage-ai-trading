// ─── Target-return / target-loss band ladder (SINGLE SOURCE) ────
// Extracted from lib/noticed/engine.ts so the trigger engine AND the
// inline threshold-crossing badge (lib/insights/threshold-badge.ts) share
// exactly one ladder. They must never drift: the badge is the on-screen
// expression of the same crossing the engine fires on.
//
// Pure module — NO server imports, safe in a client bundle.

/** Gain bands, ascending (most extreme = last crossed). */
export const POSITIVE_BANDS = [15, 25, 50, 100, 250];

/** Loss bands, descending (most extreme = last crossed). */
export const NEGATIVE_BANDS = [-10, -20, -35, -50];

/**
 * Crossing tolerance, in percentage points, applied to the DEFAULT ladder only.
 *
 * Rationale (Em, 2026-09-11): a position's total P&L % is itself a derived,
 * rounded figure (cost basis + FX + fractional lots), so a value sitting a
 * fraction below a band boundary is a real crossing for notification purposes.
 * AMD at +249.14% is the canonical example: it badges +250%, not +100%.
 * User-configured thresholds stay EXACT — a user's own number is a promise.
 */
export const BAND_TOLERANCE_PCT = 1;

/**
 * The single most-extreme band a P&L % has crossed, or null.
 *
 * User-configured thresholds (whole %, positive) replace the default ladder:
 * `targetReturnPct` fires only at exactly that gain, `targetLossPct` only at
 * exactly that loss (no tolerance).
 */
export function crossedBand(
  pnlPct: number,
  targetReturnPct?: number | null,
  targetLossPct?: number | null,
): number | null {
  if (!Number.isFinite(pnlPct)) return null;
  const userReturn = typeof targetReturnPct === 'number';
  const userLoss = typeof targetLossPct === 'number';
  const positiveBands = userReturn ? [targetReturnPct as number] : POSITIVE_BANDS;
  const negativeBands = userLoss ? [-Math.abs(targetLossPct as number)] : NEGATIVE_BANDS;
  // Tolerance applies to the default ladder only (see BAND_TOLERANCE_PCT).
  const gainTol = userReturn ? 0 : BAND_TOLERANCE_PCT;
  const lossTol = userLoss ? 0 : BAND_TOLERANCE_PCT;
  const crossed = pnlPct > 0
    ? positiveBands.filter((b) => pnlPct >= b - gainTol)
    : negativeBands.filter((b) => pnlPct <= b + lossTol);
  return crossed.length ? crossed[crossed.length - 1] : null;
}
