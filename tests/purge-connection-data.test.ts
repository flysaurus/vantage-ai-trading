// Purge-on-disconnect scope tests.
//
// Regression guard: `position_lots` keys its connection in `account_id` (UUID,
// migration 058) — it has NO `connection_id` column. The purge used to target
// `connection_id` there, so every disconnect logged a warning, skipped the
// delete, and left the connection's FIFO lots behind.

import { describe, it, expect } from 'vitest';
import { purgeConnectionDerivedData } from '@/lib/broker/purge-connection-data';

type Call = { table: string; op: string; filters: Array<[string, unknown]> };

function makeSupabase(brokerAccountsByConn: Record<string, Array<{ id: string }>> = {}) {
  const calls: Call[] = [];

  const makeBuilder = (table: string) => {
    const call: Call = { table, op: '', filters: [] };
    const b: any = {
      delete() { call.op = 'delete'; calls.push(call); return b; },
      select() { call.op = 'select'; calls.push(call); return b; },
      eq(col: string, val: unknown) { call.filters.push([`eq:${col}`, val]); return b; },
      like(col: string, val: unknown) { call.filters.push([`like:${col}`, val]); return b; },
      in(col: string, val: unknown) { call.filters.push([`in:${col}`, val]); return b; },
      then(res: any) {
        if (call.op === 'select') {
          const connFilter = call.filters.find(([k]) => k === 'eq:connection_id');
          const rows = brokerAccountsByConn[String(connFilter?.[1])] ?? [];
          return res({ data: rows, error: null });
        }
        return res({ error: null });
      },
    };
    return b;
  };

  const supabase = { from: (table: string) => makeBuilder(table) } as any;
  return { supabase, calls };
}

const USER = 'user-1';
const CONN = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

describe('purgeConnectionDerivedData — scoping', () => {
  it('deletes position_lots by account_id (legacy connection key), never connection_id', async () => {
    const { supabase, calls } = makeSupabase();
    await purgeConnectionDerivedData(supabase, USER, [CONN]);

    const lotCalls = calls.filter((c) => c.table === 'position_lots' && c.op === 'delete');
    expect(lotCalls.length).toBeGreaterThan(0);
    for (const c of lotCalls) {
      expect(c.filters).toContainEqual(['eq:account_id', CONN]);
      expect(c.filters.map(([k]) => k)).not.toContain('eq:connection_id');
    }
  });

  it('also deletes stamped lots by broker_account_id for the connection’s registered accounts', async () => {
    const { supabase, calls } = makeSupabase({ [CONN]: [{ id: 'acct-a' }, { id: 'acct-b' }] });
    await purgeConnectionDerivedData(supabase, USER, [CONN]);

    const stamped = calls.find(
      (c) => c.table === 'position_lots' && c.op === 'delete' && c.filters.some(([k]) => k === 'in:broker_account_id'),
    );
    expect(stamped).toBeTruthy();
    expect(stamped!.filters).toContainEqual(['in:broker_account_id', ['acct-a', 'acct-b']]);
  });

  it('skips the stamped-lot delete (no guess) when the registry has no accounts', async () => {
    const { supabase, calls } = makeSupabase({ [CONN]: [] });
    await purgeConnectionDerivedData(supabase, USER, [CONN]);

    const stamped = calls.find(
      (c) => c.op === 'delete' && c.filters.some(([k]) => k === 'in:broker_account_id'),
    );
    expect(stamped).toBeUndefined();
    // …but the legacy connection-keyed lot delete still runs.
    expect(
      calls.some((c) => c.table === 'position_lots' && c.filters.some(([k, v]) => k === 'eq:account_id' && v === CONN)),
    ).toBe(true);
  });

  it('scopes connection-id tables by connection_id and text-account tables by the snaptrade: prefix', async () => {
    const { supabase, calls } = makeSupabase();
    await purgeConnectionDerivedData(supabase, USER, [CONN]);

    const positions = calls.find((c) => c.table === 'positions');
    expect(positions!.filters).toContainEqual(['eq:connection_id', CONN]);
    expect(positions!.filters).toContainEqual(['eq:user_id', USER]);

    const noticed = calls.find((c) => c.table === 'noticed_items');
    expect(noticed!.filters).toContainEqual(['like:account_id', `snaptrade:${CONN}%`]);
  });

  it('does nothing for empty / duplicate / null connection ids', async () => {
    const { supabase, calls } = makeSupabase();
    await purgeConnectionDerivedData(supabase, USER, [null, undefined]);
    expect(calls.length).toBe(0);

    const { supabase: s2, calls: c2 } = makeSupabase();
    await purgeConnectionDerivedData(s2, USER, [CONN, CONN]);
    const connScoped = c2.filter(
      (c) => c.op === 'delete' && c.filters.some(([k, v]) => k === 'eq:connection_id' && v === CONN),
    );
    expect(connScoped.length).toBe(9); // each table once, not twice
  });
});
