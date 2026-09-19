import { describe, it, expect, vi, beforeEach } from 'vitest';

// A sum that omits an unknown balance is a PARTIAL, not a total — and this
// helper feeds the DCA cash guard, where a partial total can wrongly reject a
// legitimate order. Unknown must stay unknown (null ⇒ caller skips the guard).

const h = vi.hoisted(() => ({
  connections: [] as any[],
  summaries: [] as any[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: h.connections, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/broker/snaptrade-broker', () => ({
  SnapTradeBroker: class {
    async getAccount() {
      const next = h.summaries.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  },
}));

vi.mock('@/lib/snaptrade/client', () => ({
  getOrCreateSnapTradeUser: async () => ({ userId: 'u', userSecret: 's' }),
}));

import { getBrokerCashForUser } from '@/lib/broker/get-account-cash';
import { availableCash, availableCashOrNull } from '@/lib/available-cash';

const conn = (i: number) => ({
  id: `c${i}`,
  brokerage_slug: 'alpaca',
  trading_enabled: true,
  snaptrade_user_id: 'u',
  snaptrade_user_secret_encrypted: 's',
  snaptrade_connection_id: `sc${i}`,
  status: 'connected',
});

describe('getBrokerCashForUser — unknown cash never becomes a partial total', () => {
  beforeEach(() => {
    h.connections = [];
    h.summaries = [];
  });

  it('sums known balances across connections', async () => {
    h.connections = [conn(1), conn(2)];
    h.summaries = [{ cashBalance: 1000 }, { cashBalance: 250.5 }];
    await expect(getBrokerCashForUser('u1')).resolves.toBe(1250.5);
  });

  it('preserves a REAL zero (known, not unknown)', async () => {
    h.connections = [conn(1)];
    h.summaries = [{ cashBalance: 0 }];
    await expect(getBrokerCashForUser('u1')).resolves.toBe(0);
  });

  it('returns null when ANY connection fails to report cash', async () => {
    h.connections = [conn(1), conn(2)];
    h.summaries = [{ cashBalance: 1000 }, { cashBalance: null }];
    await expect(getBrokerCashForUser('u1')).resolves.toBeNull();
  });

  it('returns null when a connection fetch throws', async () => {
    h.connections = [conn(1), conn(2)];
    h.summaries = [{ cashBalance: 1000 }, new Error('balances endpoint down')];
    await expect(getBrokerCashForUser('u1')).resolves.toBeNull();
  });

  it('returns null when there is no connected broker', async () => {
    await expect(getBrokerCashForUser('u1')).resolves.toBeNull();
  });
});

describe('funds guard: unknown must skip, not reject', () => {
  it('availableCashOrNull is null when both cash and buying power are unknown', () => {
    expect(availableCashOrNull({ cash: null, buyingPower: null }, 0)).toBeNull();
  });

  it('availableCashOrNull keeps a known zero', () => {
    expect(availableCashOrNull({ cash: 0, buyingPower: 5_000 }, 0)).toBe(0);
  });

  it('availableCash (0-fallback) is exactly why the guards must branch on null', () => {
    // The old code compared against this and rejected with a fabricated "$0.00".
    expect(availableCash({ cash: null, buyingPower: null }, 0)).toBe(0);
  });
});
