// ─── Shared Account Summary ────────────────────────────────
// THE single calculation used by BOTH DemoBroker and the
// SnapTrade/real-broker path. No route computes totals
// independently — both call this same function.
//
// Formula: totalValue = cash + sum(position.units × position.price)
// Buying power is tracked separately — NEVER folded into equity.

export interface PositionInput {
  symbol: string;
  name: string;
  units: number;
  price: number;
  costBasisPerUnit?: number;
  /** null = no usable quote (unavailable) — distinct from a real 0 (flat day). */
  dayChange?: number | null;
  dayChangePct?: number | null;
  openPnl?: number;
  /** Per-position sector, resolved at broker sync (lib/sector-resolver.ts). */
  sector?: string | null;
}

export interface ComputedTotals {
  /** null = the broker did not report settled cash (UNKNOWN) — never a 0. */
  cash: number | null;
  /** null = no usable buying-power figure (non-margin, or not reported). */
  buyingPower: number | null;
  invested: number;      // sum(units × costBasis)
  marketValue: number;   // sum(units × price)
  /** cash + marketValue; null when cash is unknown (total stays unverifiable). */
  totalValue: number | null;
  /** null = NO position had a usable day change (render "—"), never a fake 0. */
  dayChange: number | null;
  dayChangePct: number | null;
  totalPnl: number;
  totalPnlPct: number;
}

export interface BalanceRowLike {
  cash?: number | null;
  buying_power?: number | null;
}

/**
 * Sum broker balances across accounts WITHOUT ever inventing a 0.
 *
 * `null` in the input means "this account's balances were unavailable" (the
 * fetch failed, or it returned no rows) — and `null` out means UNKNOWN. One
 * unavailable account poisons the whole sum: a partial total presented as a
 * total is the same fabrication as a 0, just harder to spot.
 *
 * A row that reports a field is added; a row that omits it (or reports a
 * non-finite value) marks that field unknown rather than contributing 0.
 */
export function sumBalancesHonest(
  results: ReadonlyArray<readonly BalanceRowLike[] | null | undefined>,
): { cash: number | null; buyingPower: number | null } {
  if (results.length === 0) return { cash: null, buyingPower: null };
  let cash = 0;
  let bp = 0;
  let cashKnown = true;
  let bpKnown = true;
  for (const rows of results) {
    if (!rows || rows.length === 0) {
      cashKnown = false;
      bpKnown = false;
      continue;
    }
    for (const r of rows) {
      if (typeof r.cash === 'number' && Number.isFinite(r.cash)) cash += r.cash;
      else cashKnown = false;
      if (typeof r.buying_power === 'number' && Number.isFinite(r.buying_power)) bp += r.buying_power;
      else bpKnown = false;
    }
  }
  return {
    cash: cashKnown ? Math.round(cash * 100) / 100 : null,
    buyingPower: bpKnown ? Math.round(bp * 100) / 100 : null,
  };
}

export function computeAccountSummary(
  cash: number | null,
  buyingPower: number | null,
  positions: PositionInput[],
): ComputedTotals {
  let invested = 0;
  let marketValue = 0;
  let dayChange = 0;
  let anyDayChange = false; // true once ≥1 position contributed a real number (incl. 0)
  let totalPnl = 0;

  for (const pos of positions) {
    const units = pos.units || 0;
    const price = pos.price || 0;
    const costPerUnit = pos.costBasisPerUnit || 0;

    const mv = units * price;
    const cost = units * costPerUnit;

    invested += cost;
    marketValue += mv;
    // Only sum positions that actually have a day change. A real 0 counts
    // (flat day); null (unavailable) is skipped — never treated as flat.
    if (pos.dayChange != null) {
      dayChange += pos.dayChange;
      anyDayChange = true;
    }
    totalPnl += (pos.openPnl || 0) || (mv - cost);
  }

  // A missing cash figure is UNKNOWN: totalValue cannot be derived from it, and
  // cash-derived percentages must not be invented (same rule as a fabricated 0).
  const totalValue = cash == null ? null : cash + marketValue;
  const costBasis = invested;
  // Unavailable only when NO position could produce a day change.
  const dayChangeOut = anyDayChange ? Math.round(dayChange * 100) / 100 : null;
  // A percentage off an UNKNOWN base is itself unknown — never 0.
  let dayChangePct: number | null = null;
  if (dayChangeOut != null) {
    if (totalValue == null) dayChangePct = null;
    else if (totalValue > 0 && dayChangeOut !== 0) dayChangePct = (dayChangeOut / (totalValue - dayChangeOut)) * 100;
    else dayChangePct = 0;
  }
  const totalPnlPct = costBasis > 0
    ? (totalPnl / costBasis) * 100
    : 0;

  return {
    cash: cash == null ? null : Math.round(cash * 100) / 100,
    buyingPower: buyingPower == null ? null : Math.round(buyingPower * 100) / 100,
    invested: Math.round(invested * 100) / 100,
    marketValue: Math.round(marketValue * 100) / 100,
    totalValue: totalValue == null ? null : Math.round(totalValue * 100) / 100,
    dayChange: dayChangeOut,
    dayChangePct: dayChangePct != null ? Math.round(dayChangePct * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPct: Math.round(totalPnlPct * 100) / 100,
  };
}
