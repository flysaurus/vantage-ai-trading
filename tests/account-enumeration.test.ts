// Tests for enumerateConnectionAccounts — WHICH accounts a connection exposes,
// and where each account's money values come from.
//
// Standing rule under test:
//   * registry rows exist  → they ARE the enumeration (never widen, never add
//                            an account the registry does not know)
//   * 0–1 accounts         → unchanged connection-level behaviour
//   * no usable value      → null (unknown), never a fabricated 0
import { describe, it, expect } from 'vitest';
import { enumerateConnectionAccounts, type RegisteredAccountRow } from '@/lib/broker/account-enumeration';

const SMA = '47b6f4e3-419e-43fc-ae3d-b67ea579f57d';
const YOUTH = 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe';
const R_SMA = '09934c3e-ec8f-4073-a9ae-784746106d57';
const R_YOUTH = '096d87ba-aff1-49c7-9a75-9f6000ffb498';

const reg = (id: string, snap: string | null, name: string, connection_id = 'conn-1'): RegisteredAccountRow => ({
  id, connection_id, snaptrade_account_id: snap, name, status: 'open',
});

describe('enumerateConnectionAccounts — registry first', () => {
  it('enumerates the registered sub-accounts when rows exist', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'Taxable SMA - US Large Equity'), reg(R_YOUTH, YOUTH, 'ANIKET -YOUTH ACCOUNT')],
      live: [
        { id: SMA, name: 'Taxable SMA - US Large Equity', totalValue: 377551.36, cash: 15906.16, buyingPower: null },
        { id: YOUTH, name: 'ANIKET -YOUTH ACCOUNT', totalValue: 22803.88, cash: 7981.9, buyingPower: null },
      ],
      snapshot: [],
      brokerName: 'Fidelity',
    });
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.snapAccountId)).toEqual([SMA, YOUTH]);
    expect(out.map((a) => a.brokerAccountId)).toEqual([R_SMA, R_YOUTH]);
    expect(out.map((a) => a.valueSource)).toEqual(['live', 'live']);
    expect(out[0].totalValue).toBe(377551.36);
  });

  it('never adds a live sub-account the registry does not know (no widening)', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA')],
      live: [
        { id: SMA, name: 'SMA', totalValue: 100, cash: 1, buyingPower: null },
        { id: 'stranger', name: 'Ghost', totalValue: 9_999_999, cash: 0, buyingPower: null },
      ],
      snapshot: [],
      brokerName: 'Fidelity',
    });
    expect(out).toHaveLength(1);
    expect(out[0].snapAccountId).toBe(SMA);
  });

  it('ignores closed registry rows', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA'), { ...reg(R_YOUTH, YOUTH, 'Old'), status: 'closed' }],
      live: [],
      snapshot: [],
      brokerName: 'Fidelity',
    });
    expect(out.map((a) => a.snapAccountId)).toEqual([SMA]);
  });

  it('reports unknown values (null) when there is no live match and no snapshot', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA'), reg(R_YOUTH, YOUTH, 'YOUTH')],
      live: null,
      snapshot: [],
      brokerName: 'Fidelity',
    });
    expect(out).toHaveLength(2);
    expect(out.every((a) => a.totalValue === null && a.cash === null)).toBe(true);
    expect(out.every((a) => a.valueSource === 'unknown')).toBe(true);
  });

  it('treats a snapshot 0 as unknown (the backfill captured totalValue 0 for a $377k account)', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA')],
      live: null,
      snapshot: [{ id: SMA, name: 'SMA', totalValue: 0, cash: null }],
      brokerName: 'Fidelity',
    });
    expect(out[0].totalValue).toBeNull();
    expect(out[0].valueSource).toBe('unknown');
  });

  it('falls back to a per-account snapshot value when it is believable — but never a snapshot CASH', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_YOUTH, YOUTH, 'YOUTH')],
      live: null,
      snapshot: [{ id: YOUTH, name: 'YOUTH', totalValue: 22963.15, cash: 7981.9 }],
      brokerName: 'Fidelity',
    });
    expect(out[0].totalValue).toBe(22963.15);
    expect(out[0].valueSource).toBe('snapshot');
    // The snapshot's cash was captured at connect time and has not been refreshed
    // since — it is not current cash, so it is reported as unknown, not as $7,981.90.
    expect(out[0].cash).toBeNull();
    expect(out[0].buyingPower).toBeNull();
  });

  it('never matches a snapshot entry of a DIFFERENT account id', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA')],
      live: null,
      snapshot: [{ id: YOUTH, name: 'YOUTH', totalValue: 22963.15 }],
      brokerName: 'Fidelity',
    });
    expect(out[0].totalValue).toBeNull();
    expect(out[0].name).toBe('SMA');
  });

  it('carries a null-value cash through as null, not 0 (Fidelity sub-accounts report cash: null)', () => {
    const out = enumerateConnectionAccounts({
      registered: [reg(R_SMA, SMA, 'SMA')],
      live: [{ id: SMA, name: 'SMA', totalValue: 377551.36, cash: null, buyingPower: null }],
      snapshot: [],
      brokerName: 'Fidelity',
    });
    expect(out[0].cash).toBeNull();
    expect(out[0].totalValue).toBe(377551.36);
  });
});

describe('enumerateConnectionAccounts — legacy path (no registry rows)', () => {
  it('uses the live sub-accounts when the registry is empty (0–1 accounts unchanged)', () => {
    const out = enumerateConnectionAccounts({
      registered: [],
      live: [{ id: 'acct-a', name: 'Alpaca Paper', totalValue: 101930.84, cash: 100865.95, buyingPower: 305809.72 }],
      snapshot: [],
      brokerName: 'Alpaca Paper',
    });
    expect(out).toHaveLength(1);
    expect(out[0].brokerAccountId).toBeNull();
    expect(out[0].totalValue).toBe(101930.84);
    expect(out[0].valueSource).toBe('live');
  });

  it('falls back to the snapshot, then to a single unknown connection-level entry', () => {
    const fromSnap = enumerateConnectionAccounts({
      registered: [], live: null,
      snapshot: [{ id: 'acct-a', name: 'Alpaca Paper', totalValue: 101930.84, cash: 100865.95 }],
      brokerName: 'Alpaca Paper',
    });
    expect(fromSnap[0].valueSource).toBe('snapshot');

    const empty = enumerateConnectionAccounts({ registered: [], live: null, snapshot: [], brokerName: 'Alpaca Paper' });
    expect(empty).toHaveLength(1);
    expect(empty[0].snapAccountId).toBeNull();
    expect(empty[0].totalValue).toBeNull();
    expect(empty[0].cash).toBeNull();
    expect(empty[0].valueSource).toBe('unknown');
  });
});
