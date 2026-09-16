// ─── Part B step 5: FIFO lot consumption scope (unit) ───────────────────────
// `consumeLotsForSell` may narrow to ONE sub-account (`broker_account_id`).
// Omitting the argument MUST keep the legacy connection-level query, so single
// account connections and pre-stamping lots behave exactly as before.

import { describe, it, expect } from 'vitest';
import { consumeLotsForSell } from '@/lib/fifo-ledger';

function makeStub(rows: any[] = []) {
  const filters: [string, unknown][] = [];
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
    is: (c: string, v: unknown) => { filters.push([`is:${c}`, v]); return builder; },
    gt: (c: string, v: unknown) => { filters.push([`gt:${c}`, v]); return builder; },
    order: () => builder,
    update: () => builder,
    then: (res: any) => res({ data: rows, error: null }),
  };
  const client: any = { from: () => builder };
  return { client, filters };
}

const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';
const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '09934c3e-ec8f-4073-a9ae-784746106d57';

describe('consumeLotsForSell — account scope', () => {
  it('legacy behaviour (no brokerAccountId) is unchanged: connection scope only', async () => {
    const { client, filters } = makeStub([]);
    await consumeLotsForSell(client, USER, CONN, 'AAPL', 5);
    expect(filters).toContainEqual(['account_id', CONN]);
    expect(filters.map((f) => f[0])).not.toContain('broker_account_id');
  });

  it('demo / no-connection lots keep the IS NULL account filter', async () => {
    const { client, filters } = makeStub([]);
    await consumeLotsForSell(client, USER, null, 'AAPL', 5);
    expect(filters).toContainEqual(['is:account_id', null]);
    expect(filters.map((f) => f[0])).not.toContain('broker_account_id');
  });

  it('a resolved sub-account narrows consumption to that account only', async () => {
    const { client, filters } = makeStub([
      { id: 'lot-1', qty: 10, remaining_qty: 10, price_at_fill: 100, filled_at: '2026-09-01T00:00:00Z' },
    ]);
    const res = await consumeLotsForSell(client, USER, CONN, 'AAPL', 4, SMA);
    expect(filters).toContainEqual(['account_id', CONN]);
    expect(filters).toContainEqual(['broker_account_id', SMA]);
    // Scoped read keeps the FIFO ordering + open-lot constraints.
    expect(filters).toContainEqual(['gt:remaining_qty', 0]);
    expect(res.untracked).toBe(false);
    expect(res.total_qty_consumed).toBe(4);
    expect(res.shortfall).toBe(0);
  });

  it('an empty scoped ledger reports a shortfall rather than cross-account merging', async () => {
    const { client } = makeStub([]);
    const res = await consumeLotsForSell(client, USER, CONN, 'AAPL', 4, SMA);
    expect(res.untracked).toBe(true);
    expect(res.shortfall).toBe(4);
    expect(res.consumed).toEqual([]);
  });
});
