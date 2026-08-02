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
  dayChange?: number;
  dayChangePct?: number;
  openPnl?: number;
}

export interface ComputedTotals {
  cash: number;
  buyingPower: number;
  invested: number;      // sum(units × costBasis)
  marketValue: number;   // sum(units × price)
  totalValue: number;    // cash + marketValue
  dayChange: number;
  dayChangePct: number;
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
  let totalPnl = 0;

  for (const pos of positions) {
    const units = pos.units || 0;
    const price = pos.price || 0;
    const costPerUnit = pos.costBasisPerUnit || 0;

    const mv = units * price;
    const cost = units * costPerUnit;

    invested += cost;
    marketValue += mv;
    dayChange += (pos.dayChange || 0);
    totalPnl += (pos.openPnl || 0) || (mv - cost);
  }

  const totalValue = cash + marketValue;
  const costBasis = invested;
  const dayChangePct = totalValue > 0 && dayChange !== 0
    ? (dayChange / (totalValue - dayChange)) * 100
    : 0;
  const totalPnlPct = costBasis > 0
    ? (totalPnl / costBasis) * 100
    : 0;

  return {
    cash: Math.round(cash * 100) / 100,
    buyingPower: Math.round(buyingPower * 100) / 100,
    invested: Math.round(invested * 100) / 100,
    marketValue: Math.round(marketValue * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    dayChange: Math.round(dayChange * 100) / 100,
    dayChangePct: Math.round(dayChangePct * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalPnlPct: Math.round(totalPnlPct * 100) / 100,
  };
}
