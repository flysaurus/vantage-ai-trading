// ─── Part B step 3b: write-side account stamping (unit) ─────────────────────
// Contract locked here:
//   • flag OFF (default)  → null, and NOT A SINGLE database call
//   • flag ON             → exact (connection_id, snaptrade_account_id) lookup
//   • incomplete scope    → null, no query
//   • no match / error    → null (unattributed, never a guess)
//   • memoised per scope, keyed by user too

import { describe, it, expect, beforeEach } from 'vitest';
import {
  accountIdWritesEnabled,
  resolveBrokerAccountIdForWrite,
  __clearAccountIdCache,
  ACCOUNT_ID_WRITES_ENV,
} from '@/lib/broker/account-id';

const ON = { [ACCOUNT_ID_WRITES_ENV]: '1' };
const OFF = {};

/** Minimal PostgREST-shaped stub that records every filter it is given. */
function makeSupabase(result: { data: any; error: any } = { data: null, error: null }) {
  const calls: any = { selects: 0, filters: [] as [string, unknown][], tables: [] as string[] };
  const builder: any = {
    select: (cols: string) => { calls.selects++; calls.cols = cols; return builder; },
    eq: (col: string, val: unknown) => { calls.filters.push([col, val]); return builder; },
    maybeSingle: async () => result,
  };
  const client: any = { from: (t: string) => { calls.tables.push(t); return builder; } };
  return { client, calls };
}

const SCOPE = {
  userId: '58ffa82a-2b14-4a5d-9662-5c48f105031f',
  connectionId: '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc',
  snapAccountId: '47b6f4e3-419e-43fc-ae3d-b67ea579f57d',
};

beforeEach(() => __clearAccountIdCache());

describe('accountIdWritesEnabled', () => {
  it('defaults OFF — only the literal "1" enables it', () => {
    expect(accountIdWritesEnabled(OFF)).toBe(false);
    expect(accountIdWritesEnabled({ [ACCOUNT_ID_WRITES_ENV]: 'true' })).toBe(false);
    expect(accountIdWritesEnabled({ [ACCOUNT_ID_WRITES_ENV]: '0' })).toBe(false);
    expect(accountIdWritesEnabled(ON)).toBe(true);
  });
});

describe('resolveBrokerAccountIdForWrite — flag off (inert)', () => {
  it('returns null and touches the database zero times', async () => {
    const { client, calls } = makeSupabase({ data: { id: 'abc' }, error: null });
    const id = await resolveBrokerAccountIdForWrite(client, SCOPE, OFF);
    expect(id).toBeNull();
    expect(calls.tables).toEqual([]);
    expect(calls.selects).toBe(0);
  });
});

describe('resolveBrokerAccountIdForWrite — flag on', () => {
  it('resolves the row via an exact (connection_id, snaptrade_account_id) match', async () => {
    const { client, calls } = makeSupabase({
      data: { id: '09934c3e-ec8f-4073-a9ae-784746106d57' },
      error: null,
    });
    const id = await resolveBrokerAccountIdForWrite(client, SCOPE, ON);
    expect(id).toBe('09934c3e-ec8f-4073-a9ae-784746106d57');
    expect(calls.tables).toEqual(['broker_accounts']);
    expect(calls.filters).toEqual([
      ['connection_id', SCOPE.connectionId],
      ['snaptrade_account_id', SCOPE.snapAccountId],
    ]);
  });

  it('never infers: no match ⇒ null (row stays unattributed)', async () => {
    const { client } = makeSupabase({ data: null, error: null });
    expect(await resolveBrokerAccountIdForWrite(client, SCOPE, ON)).toBeNull();
  });

  it('a lookup error ⇒ null, and the write is not blocked', async () => {
    const { client } = makeSupabase({ data: null, error: { message: 'boom' } });
    await expect(resolveBrokerAccountIdForWrite(client, SCOPE, ON)).resolves.toBeNull();
  });

  it.each([
    ['missing snapAccountId', { ...SCOPE, snapAccountId: null }],
    ['missing connectionId', { ...SCOPE, connectionId: null }],
    ['missing userId', { ...SCOPE, userId: null }],
    ['empty strings', { userId: '', connectionId: '', snapAccountId: '' }],
  ])('%s ⇒ null, and no query is issued', async (_label, scope) => {
    const { client, calls } = makeSupabase({ data: { id: 'should-not-be-used' }, error: null });
    expect(await resolveBrokerAccountIdForWrite(client, scope as any, ON)).toBeNull();
    expect(calls.tables).toEqual([]);
  });

  it('memoises per scope (one lookup for a whole multi-row sync)', async () => {
    const { client, calls } = makeSupabase({ data: { id: 'lot-account' }, error: null });
    const a = await resolveBrokerAccountIdForWrite(client, SCOPE, ON);
    const b = await resolveBrokerAccountIdForWrite(client, SCOPE, ON);
    expect(a).toBe('lot-account');
    expect(b).toBe('lot-account');
    expect(calls.selects).toBe(1);
  });

  it('negative results are memoised too, and a different account is a separate key', async () => {
    const first = makeSupabase({ data: null, error: null });
    expect(await resolveBrokerAccountIdForWrite(first.client, SCOPE, ON)).toBeNull();
    expect(await resolveBrokerAccountIdForWrite(first.client, SCOPE, ON)).toBeNull();
    expect(first.calls.selects).toBe(1);

    const other = makeSupabase({
      data: { id: '096d87ba-aff1-49c7-9a75-9f6000ffb498' },
      error: null,
    });
    const id = await resolveBrokerAccountIdForWrite(
      other.client,
      { ...SCOPE, snapAccountId: 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe' },
      ON,
    );
    expect(id).toBe('096d87ba-aff1-49c7-9a75-9f6000ffb498');
    expect(other.calls.selects).toBe(1);
  });
});
