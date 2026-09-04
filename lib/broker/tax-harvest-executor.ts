// ─── Tax-loss-harvest order execution (SnapTrade) ─────────────
// Pure/deterministic pieces of the tax-harvest execute flow, extracted from
// `app/api/strategies/tax-harvest/execute/route.ts` (and its legacy sibling
// `tax-harvesting/execute`) so the sell + replacement-buy sequence can be
// unit-tested without the Next.js request/response layer.
//
// ⚠️ REAL MONEY: these build live market orders (SELL losers, BUY replacements).
// Do not call outside the tax-harvest execute routes (auth + tradingEnabled
// gated). Reuses the SAME order-placement/persist engine as rebalance.
// ──────────────────────────────────────────────────────────────

import {
  placeRebalanceTrade,
  type RebalanceTrade,
  type RebalanceLegOutcome,
} from '@/lib/broker/rebalance-executor';

export interface TaxHarvestLeg {
  /** Ticker being sold to realize the loss. */
  sellSymbol: string;
  /** Number of shares to sell (full-position harvest → the whole position). */
  sellShares: number;
  /** Replacement ticker to buy (optional — null/undefined = harvest only). */
  buySymbol?: string | null;
  /** Replacement share count (computed by the caller from $ amount ÷ price). */
  buyShares?: number;
}

export interface TaxHarvestLegOutcome {
  sellSymbol: string;
  sell: RebalanceLegOutcome;
  /** null when no replacement was requested. */
  buy: RebalanceLegOutcome | null;
}

/**
 * Place ONE harvest leg: SELL the losing position, then (if a replacement was
 * selected) BUY the replacement. Both legs are persisted with
 * `source = 'tax_harvest'`. Never throws — per-leg failures are captured in
 * the returned outcomes.
 */
export async function placeTaxHarvestLeg(
  broker: { placeOrder: (req: any) => Promise<any> },
  supabase: { from: (table: string) => any },
  params: { userId: string; brokerConnectionId: string; leg: TaxHarvestLeg },
): Promise<TaxHarvestLegOutcome> {
  const { userId, brokerConnectionId, leg } = params;
  const sellSymbol = leg.sellSymbol.toUpperCase();

  const sellTrade: RebalanceTrade = {
    symbol: sellSymbol,
    action: 'sell',
    shares: leg.sellShares,
    estimatedValue: 0,
  };
  const sell = await placeRebalanceTrade(
    broker,
    supabase,
    { userId, brokerConnectionId, trade: sellTrade },
    'tax_harvest',
  );

  let buy: RebalanceLegOutcome | null = null;
  // 🔴 Safety rail: only buy the replacement AFTER the losing position actually
  // sold. Buying without a confirmed sell would double-expose the user and
  // defeat the harvest (or trigger a wash-sale-adjacent mistake).
  if (sell.success && leg.buySymbol && leg.buyShares && leg.buyShares > 0) {
    const buyTrade: RebalanceTrade = {
      symbol: leg.buySymbol.toUpperCase(),
      action: 'buy',
      shares: leg.buyShares,
      estimatedValue: 0,
    };
    buy = await placeRebalanceTrade(
      broker,
      supabase,
      { userId, brokerConnectionId, trade: buyTrade },
      'tax_harvest',
    );
  }

  return { sellSymbol, sell, buy };
}

/**
 * Compute the replacement BUY share count from a target dollar amount and the
 * replacement's live price. Floor to whole shares; never below 1 share when an
 * amount is provided. Pure + deterministic (extracted for testability).
 */
export function computeReplacementShares(targetAmountUsd: number, price: number): number {
  if (!Number.isFinite(targetAmountUsd) || targetAmountUsd <= 0) return 0;
  if (!Number.isFinite(price) || price <= 0) return 0;
  return Math.max(1, Math.floor(targetAmountUsd / price));
}
