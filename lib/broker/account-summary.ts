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
}

export interface ComputedTotals {
  cash: number;
  buyingPower: number;
  invested: number;      // sum(units × costBasis)
  marketValue: number;   // sum(units × price)
  totalValue: number;    // cash + marketValue
  /** null = NO position had a usable day change (render "—"), never a fake 0. */
  dayChange: number | null;
  dayChangePct: number | null;
  totalPnl: number;
  totalPnlPct: number;
}

export function computeAccountSummary(
  cash: number,
  buyingPower: number,
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

  const totalValue = cash + marketValue;
  const costBasis = invested;
  // Unavailable only when NO position could produce a day change.
  const dayChangeOut = anyDayChange ? Math.round(dayChange * 100) / 100 : null;
  const dayChangePct = dayChangeOut != null && totalValue > 0 && dayChangeOut !== 0
    ? (dayChangeOut / (totalValue - dayChangeOut)) * 100
    : dayChangeOut != null ? 0 : null;
  const totalPnlPct = costBasis > 0
    ? (totalPnl / costBasis) * 100
    : 0;

  return {
    cash: Math.round(cash * 100) / 100,
    buyingPower: Math.round(buyingPower * 100) / 100,
    invested: Math.round(invested * 100) / 100,
    marketValue: Math.round(marketValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    dayChange: dayChangeOut,
    dayChangePct: dayChangePct != null ? Math.round(dayChangePct * 100) / 100 : null,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPct: Math.round(totalPnlPct * 100) / 100,
  };
}
