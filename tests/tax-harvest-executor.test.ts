// ═══════════════════════════════════════════════════════════════
// tests/tax-harvest-executor.test.ts — tax-loss-harvest execution
// ═══════════════════════════════════════════════════════════════
//
// Covers the pure pieces of the tax-harvest execute flow: replacement-share
// computation and the sell + optional replacement-buy leg. No live broker
// calls — mock-based only.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import {
  placeTaxHarvestLeg,
  computeReplacementShares,
} from '../lib/broker/tax-harvest-executor';
import type { OrderResult } from '../lib/broker/types';

describe('computeReplacementShares', () => {
  it('floors to whole shares and never below 1 when amount valid', () => {
    expect(computeReplacementShares(1000, 210)).toBe(4); // 4.76 → 4
    expect(computeReplacementShares(100, 210)).toBe(1); // 0.47 → 1
  });

  it('returns 0 for non-positive amount or price', () => {
    expect(computeReplacementShares(0, 100)).toBe(0);
    expect(computeReplacementShares(-50, 100)).toBe(0);
    expect(computeReplacementShares(100, 0)).toBe(0);
    expect(computeReplacementShares(NaN, 100)).toBe(0);
  });
});

describe('placeTaxHarvestLeg', () => {
  function makeSupabase() {
    const inserted: any[] = [];
    const from = vi.fn((table: string) => ({
      insert: (row: any) => {
        inserted.push({ table, row });
        return {
          select: () => ({ single: async () => ({ data: { id: row.id }, error: null }) }),
        };
      },
    }));
    return { from, inserted };
  }

  it('sells only (no replacement) and persists with source=tax_harvest', async () => {
    const broker = {
      placeOrder: vi.fn(async (req: any): Promise<OrderResult> => ({
        success: true,
        orderId: 'broker-sell',
        status: 'FILLED',
        fillPrice: 50,
        filledShares: 20,
        symbol: req.symbol,
      })),
    };
    const supabase = makeSupabase();

    const out = await placeTaxHarvestLeg(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      leg: { sellSymbol: 'XYZ', sellShares: 20 },
    });

    expect(out.sell.success).toBe(true);
    expect(out.sell.orderId).toBe('broker-sell');
    expect(out.buy).toBeNull();
    expect(broker.placeOrder).toHaveBeenCalledTimes(1);
    expect(broker.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'XYZ', side: 'SELL', shares: 20 }),
    );
    expect(supabase.inserted).toHaveLength(1);
    expect(supabase.inserted[0].row.source).toBe('tax_harvest');
    expect(supabase.inserted[0].row.side).toBe('sell');
  });

  it('sells then buys the replacement (2 orders, both tax_harvest)', async () => {
    const broker = {
      placeOrder: vi.fn(async (req: any): Promise<OrderResult> => ({
        success: true,
        orderId: req.side === 'SELL' ? 'broker-sell' : 'broker-buy',
        status: 'FILLED',
        fillPrice: 100,
        filledShares: req.shares,
        symbol: req.symbol,
      })),
    };
    const supabase = makeSupabase();

    const out = await placeTaxHarvestLeg(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      leg: { sellSymbol: 'XYZ', sellShares: 10, buySymbol: 'ABC', buyShares: 5 },
    });

    expect(out.sell.success).toBe(true);
    expect(out.buy).not.toBeNull();
    expect(out.buy!.success).toBe(true);
    expect(out.buy!.orderId).toBe('broker-buy');
    expect(broker.placeOrder).toHaveBeenCalledTimes(2);
    expect(supabase.inserted).toHaveLength(2);
    expect(supabase.inserted[0].row.side).toBe('sell');
    expect(supabase.inserted[1].row.side).toBe('buy');
    expect(supabase.inserted.every((i: any) => i.row.source === 'tax_harvest')).toBe(true);
  });

  it('captures a sell failure and skips the buy', async () => {
    const broker = {
      placeOrder: vi.fn(async (req: any): Promise<OrderResult> => ({
        success: false,
        orderId: 'error',
        status: 'REJECTED',
        message: 'Insufficient shares',
        symbol: req.symbol,
      })),
    };
    const supabase = makeSupabase();

    const out = await placeTaxHarvestLeg(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      leg: { sellSymbol: 'XYZ', sellShares: 10, buySymbol: 'ABC', buyShares: 5 },
    });

    expect(out.sell.success).toBe(false);
    expect(out.sell.error).toContain('Insufficient shares');
    // 🔴 Buy is skipped when the sell fails — never double-expose the user.
    expect(out.buy).toBeNull();
    expect(broker.placeOrder).toHaveBeenCalledTimes(1);
  });
});
