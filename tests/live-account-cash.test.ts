// ─── Live account cash: stale snapshot vs live balances ─────────────────────
// `broker_connections.snaptrade_accounts` is written once at connect and never
// refreshed. Using its `cash` produced "Invest $100,865" for an Alpaca account
// holding $468.81. Cash must come from the live balances endpoint or be
// reported unknown — never from the snapshot, never merged across siblings.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  balances: null as any,
  listed: null as any,
  conn: null as any,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.conn, error: null }) }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/snaptrade/client', () => ({
  getAccountBalances: vi.fn(async (id: string) => {
    if (h.balances instanceof Error) throw h.balances;
    return h.balances;
  }),
  getOrCreateSnapTradeUser: vi.fn(async () => ({ userId: 'snap-user', userSecret: 'secret', isNew: false })),
}));

import { getAccountBalances, getOrCreateSnapTradeUser } from '@/lib/snaptrade/client';
import { resolveLiveAccountCash, __clearLiveCashCache } from '@/lib/broker/live-account-cash';

const USER = 'u1';
const CONN = 'conn-1';
const SMA = 'sma-id';
const YOUTH = 'youth-id';

beforeEach(() => {
  __clearLiveCashCache();
  (getAccountBalances as unknown as ReturnType<typeof vi.fn>).mockClear();
  (getOrCreateSnapTradeUser as unknown as ReturnType<typeof vi.fn>).mockClear();
  h.balances = [{ currency: { code: 'USD' }, cash: 468.81, buying_power: null }];
  h.conn = {
    snaptrade_user_id: 'snap-user',
    snaptrade_user_secret_encrypted: 'enc',
    snaptrade_connection_id: 'auth-1',
    snaptrade_accounts: [{ id: 'alp-id', cash: 100865.95, totalValue: 101930.84 }],
  };
});

describe('resolveLiveAccountCash', () => {
  it('reads the live balances endpoint and ignores the stale snapshot cash', async () => {
    const v = await resolveLiveAccountCash(USER, CONN, 'alp-id');
    expect(v).toBeCloseTo(468.81, 2);
    expect(v).not.toBeCloseTo(100865.95, 2); // snapshot value must never surface
    expect(getAccountBalances).toHaveBeenCalledWith('alp-id', 'snap-user', 'secret');
  });

  it('sums multi-currency rows only when every row reports a number', async () => {
    h.balances = [{ cash: 100 }, { cash: 20.5 }];
    expect(await resolveLiveAccountCash(USER, CONN, 'alp-id')).toBeCloseTo(120.5, 2);
  });

  it('one null balance row poisons the sum — unknown, not an understated figure', async () => {
    h.balances = [{ cash: 100 }, { cash: null }];
    expect(await resolveLiveAccountCash(USER, CONN, 'alp-id')).toBeNull();
  });

  it('empty balances ⇒ unknown', async () => {
    h.balances = [];
    expect(await resolveLiveAccountCash(USER, CONN, 'alp-id')).toBeNull();
  });

  it('endpoint failure ⇒ unknown (never a guessed fallback)', async () => {
    h.balances = new Error('502 from SnapTrade');
    expect(await resolveLiveAccountCash(USER, CONN, 'alp-id')).toBeNull();
  });

  it('shared login with no sub-account scope ⇒ unknown, and no balances call', async () => {
    h.conn.snaptrade_accounts = [{ id: SMA }, { id: YOUTH }];
    expect(await resolveLiveAccountCash(USER, CONN, null)).toBeNull();
    expect(getAccountBalances).not.toHaveBeenCalled();
  });

  it('connection-level call on a SINGLE-account connection resolves that account', async () => {
    h.conn.snaptrade_accounts = [{ id: 'alp-id', cash: 100865.95 }];
    expect(await resolveLiveAccountCash(USER, CONN, null)).toBeCloseTo(468.81, 2);
    expect(getAccountBalances).toHaveBeenCalledWith('alp-id', 'snap-user', 'secret');
  });

  it('missing SnapTrade authorization ⇒ unknown', async () => {
    h.conn.snaptrade_connection_id = null;
    expect(await resolveLiveAccountCash(USER, CONN, 'alp-id')).toBeNull();
  });

  it('caches the answer briefly (one network call for repeat lookups)', async () => {
    await resolveLiveAccountCash(USER, CONN, 'alp-id');
    await resolveLiveAccountCash(USER, CONN, 'alp-id');
    expect((getAccountBalances as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
  });
});
