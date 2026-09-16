// ─── Part B §6: "Rufus Noticed" FEED scope on a shared login ───────────────
// Stored rows carry the account id they were generated for. Two shapes exist:
//   'snaptrade:<conn>:<snap_account>'  (scoped — written by the scoped pipeline)
//   'snaptrade:<conn>'                 (legacy, connection-level)
// On a connection exposing 2+ sub-accounts a legacy row cannot be attributed to
// either account: it must be HIDDEN, both when a sub-account is active and when
// the ambiguous connection-level id is asked for. (The 2026-09-16 Fidelity bug:
// "Taxable SMA" showed ANIKET-YOUTH's SPY 35.8% concentration card.)

import { describe, it, expect } from 'vitest';
import { resolveNoticedAccountIds } from '@/lib/noticed/feed-scope';

const CONN = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

const client = (accounts: any[] | null, opts: { throws?: boolean } = {}) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (opts.throws) throw new Error('db down');
            return { data: accounts ? { snaptrade_accounts: accounts } : null, error: null };
          },
        }),
      }),
    }),
  }),
});

const TWO = [{ id: SMA }, { id: YOUTH }];
const ONE = [{ id: 'alp' }];

describe('resolveNoticedAccountIds', () => {
  it('sub-account scope on a shared login sees ONLY its own rows', async () => {
    const ids = await resolveNoticedAccountIds(client(TWO) as any, USER, `snaptrade:${CONN}:${SMA}`);
    expect(ids).toEqual([`snaptrade:${CONN}:${SMA}`]);
  });

  it('a shared login has no connection-level scope — returns nothing, not a guess', async () => {
    const ids = await resolveNoticedAccountIds(client(TWO) as any, USER, `snaptrade:${CONN}`);
    expect(ids).toEqual([]);
  });

  it('single-account connection keeps the legacy row visible', async () => {
    const scoped = await resolveNoticedAccountIds(client(ONE) as any, USER, `snaptrade:${CONN}:alp`);
    expect(scoped).toEqual([`snaptrade:${CONN}:alp`, `snaptrade:${CONN}`]);
    const legacy = await resolveNoticedAccountIds(client(ONE) as any, USER, `snaptrade:${CONN}`);
    expect(legacy).toEqual([`snaptrade:${CONN}`]);
  });

  it('a failed account-list lookup keeps the single-account default (never blanks the feed)', async () => {
    const ids = await resolveNoticedAccountIds(client(null, { throws: true }) as any, USER, `snaptrade:${CONN}`);
    expect(ids).toEqual([`snaptrade:${CONN}`]);
  });

  it('demo scope is untouched', async () => {
    expect(await resolveNoticedAccountIds(client(TWO) as any, USER, 'demo')).toEqual(['demo']);
  });
});
