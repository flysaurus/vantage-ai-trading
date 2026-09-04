// ═══════════════════════════════════════════════════════════════
// tests/rebalance-executor.test.ts — Phase 4 rebalance order execution
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/rebalance-executor.test.ts
//
// Covers the pure/deterministic pieces of the rebalance execute flow (extracted
// into lib/broker/rebalance-executor.ts): order-request mapping, persist-row
// construction, and per-leg outcome/error handling. No live broker calls.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, vi } from 'vitest';
import {
  buildRebalanceOrderRequest,
  buildRebalanceInsertRow,
  placeRebalanceTrade,
  PHANTOM_ORDER_IDS,
  type RebalanceTrade,
} from '../lib/broker/rebalance-executor';
import type { OrderResult } from '../lib/broker/types';

const trade: RebalanceTrade = { symbol: 'aapl', action: 'buy', shares: 10, estimatedValue: 2000 };

describe('buildRebalanceOrderRequest', () => {
  it('maps buy → BUY, uppercases symbol, passes shares + day TIF', () => {
    const req = buildRebalanceOrderRequest(trade, 'uuid-1');
    expect(req).toEqual({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'market',
      shares: 10,
      timeInForce: 'day',
      clientOrderId: 'uuid-1',
    });
  });

  it('maps sell → SELL', () => {
    const req = buildRebalanceOrderRequest({ ...trade, action: 'sell' }, 'uuid-2');
    expect(req.side).toBe('SELL');
  });
});

describe('buildRebalanceInsertRow', () => {
  const result: OrderResult = {
    success: true,
    orderId: 'broker-123',
    status: 'FILLED',
    fillPrice: 210,
    filledShares: 10,
    filledAt: '2026-09-04T00:00:00.000Z',
  };

  it('builds a share-based row with source=rebalance', () => {
    const row = buildRebalanceInsertRow({
      orderId: 'uuid-1',
      userId: 'user-1',
      brokerConnectionId: 'conn-1',
      trade,
      result,
      now: '2026-09-04T12:00:00.000Z',
    });
    expect(row).toMatchObject({
      id: 'uuid-1',
      user_id: 'user-1',
      connection_id: 'conn-1',
      symbol: 'AAPL',
      qty: 10,
      order_unit: 'shares',
      requested_amount: 2100, // 10 * 210
      requested_qty: 10,
      filled_qty: 10,
      side: 'buy',
      order_type: 'market',
      status: 'filled', // lowercase
      filled_price: 210,
      filled_at: '2026-09-04T00:00:00.000Z',
      time_in_force: 'day',
      is_demo: false,
      brokerage_order_id: 'broker-123',
      source: 'rebalance',
      created_at: '2026-09-04T12:00:00.000Z',
    });
  });

  it('nulls requested_amount when no fillPrice, and sets filled_qty 0 when not FILLED', () => {
    const row = buildRebalanceInsertRow({
      orderId: 'uuid-1',
      userId: 'user-1',
      brokerConnectionId: 'conn-1',
      trade,
      result: { success: true, orderId: 'broker-9', status: 'SUBMITTED' },
      now: 'now',
    });
    expect(row.requested_amount).toBeNull();
    expect(row.filled_qty).toBe(0);
    expect(row.filled_at).toBeNull();
    expect(row.status).toBe('submitted');
  });
});

describe('placeRebalanceTrade', () => {
  function makeSupabase() {
    const inserted: any[] = [];
    const from = vi.fn((table: string) => ({
      insert: (row: any) => {
        inserted.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { id: row.id }, error: null }),
          }),
        };
      },
    }));
    return { from, inserted };
  }

  it('places and persists a successful order', async () => {
    const broker = {
      placeOrder: vi.fn(async (): Promise<OrderResult> => ({
        success: true,
        orderId: 'broker-1',
        status: 'FILLED',
        fillPrice: 210,
        filledShares: 10,
      })),
    };
    const supabase = makeSupabase();

    const out = await placeRebalanceTrade(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      trade,
    });

    expect(out.success).toBe(true);
    expect(out.orderId).toBe('broker-1');
    expect(out.error).toBeNull();
    expect(out.persisted).toBe(true);
    expect(broker.placeOrder).toHaveBeenCalledTimes(1);
    expect(supabase.from).toHaveBeenCalledWith('orders');
    expect(supabase.inserted[0].row.source).toBe('rebalance');
    expect(supabase.inserted[0].row.side).toBe('buy');
  });

  it('persists a broker-rejected order (non-phantom, orderId "error")', async () => {
    const broker = {
      placeOrder: vi.fn(async (): Promise<OrderResult> => ({
        success: false,
        orderId: 'error',
        status: 'REJECTED',
        message: 'Insufficient buying power',
      })),
    };
    const supabase = makeSupabase();

    const out = await placeRebalanceTrade(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      trade,
    });

    expect(out.success).toBe(false);
    expect(out.orderId).toBeNull();
    expect(out.error).toContain('Insufficient buying power');
    expect(out.persisted).toBe(true); // real broker order → persist as rejected
    expect(supabase.inserted[0].row.status).toBe('rejected');
  });

  it('skips persistence for phantom (pre-broker) results', async () => {
    const broker = {
      placeOrder: vi.fn(async (): Promise<OrderResult> => ({
        success: false,
        orderId: 'no-qty',
        status: 'REJECTED',
        message: 'Order must specify shares or dollar amount.',
      })),
    };
    const supabase = makeSupabase();

    const out = await placeRebalanceTrade(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      trade,
    });

    expect(out.success).toBe(false);
    expect(out.persisted).toBe(false);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('captures broker throw without persisting', async () => {
    const broker = {
      placeOrder: vi.fn(async () => {
        throw new Error('network down');
      }),
    };
    const supabase = makeSupabase();

    const out = await placeRebalanceTrade(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      trade,
    });

    expect(out.success).toBe(false);
    expect(out.error).toContain('network down');
    expect(out.persisted).toBe(false);
    expect(supabase.inserted).toHaveLength(0);
  });

  it('still reports success when persist fails (non-fatal)', async () => {
    const broker = {
      placeOrder: vi.fn(async (): Promise<OrderResult> => ({
        success: true,
        orderId: 'broker-2',
        status: 'SUBMITTED',
      })),
    };
    const supabase = {
      from: vi.fn(() => ({
        insert: () => ({
          select: () => ({
            single: async () => {
              throw new Error('db down');
            },
          }),
        }),
      })),
    };

    const out = await placeRebalanceTrade(broker, supabase as any, {
      userId: 'u1',
      brokerConnectionId: 'c1',
      trade,
    });

    expect(out.success).toBe(true);
    expect(out.orderId).toBe('broker-2');
    expect(out.persisted).toBe(false); // persist failed, order still live
  });
});

describe('PHANTOM_ORDER_IDS', () => {
  it('contains the pre-broker sentinel ids', () => {
    expect([...PHANTOM_ORDER_IDS].sort()).toEqual(
      ['bad-symbol', 'no-account', 'no-qty', 'readonly', 'unknown'].sort(),
    );
  });
});
