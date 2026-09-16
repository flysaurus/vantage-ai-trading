/**
 * Connection cards — one card per connection, no summing across sub-accounts.
 *
 * Context: with 2+ connections the unscoped `GET /api/broker/status` correctly
 * refuses to guess (connected + ambiguous, brokerId null). The Broker
 * Connections page used that single read, so it rendered NO connected card and
 * the Disconnect action was unreachable (A-2). The page now enumerates
 * connections from the account list — the same per-sub-account ids the switcher
 * uses — and scopes every status read by connectionId.
 *
 * These tests pin the grouping + the no-sum invariant.
 */
import { describe, it, expect } from 'vitest';
import {
  groupLiveAccountsByConnection,
  type LiveAccountEntry,
} from '@/lib/broker/connection-cards';

const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

function entry(over: Partial<LiveAccountEntry>): LiveAccountEntry {
  return {
    id: 'x',
    name: 'Account',
    isDemo: false,
    tradingEnabled: false,
    totalValue: 0,
    ...over,
  };
}

const FIDELITY_SMA = entry({
  id: `snaptrade:${FIDELITY}:47b6f4e3-419e-43fc-ae3d-b67ea579f57d`,
  name: 'Taxable SMA - US Large Equity',
  broker: 'Fidelity',
  brokerageSlug: 'FIDELITY',
  connectionId: FIDELITY,
  snapAccountId: '47b6f4e3-419e-43fc-ae3d-b67ea579f57d',
  totalValue: 377_551.36,
  environment: 'live',
});

const FIDELITY_YOUTH = entry({
  id: `snaptrade:${FIDELITY}:c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe`,
  name: 'ANIKET -YOUTH ACCOUNT',
  broker: 'Fidelity',
  brokerageSlug: 'FIDELITY',
  connectionId: FIDELITY,
  snapAccountId: 'c0c932a5-bafc-46b6-b3ab-e5d2c5e0babe',
  totalValue: 22_803.88,
  environment: 'live',
});

const ALPACA_PAPER = entry({
  id: `snaptrade:${ALPACA}:51564504-a85f-4dbb-bcf9-6d8d9716596b`,
  name: 'Alpaca Paper',
  broker: 'Alpaca',
  brokerageSlug: 'ALPACA-PAPER',
  connectionId: ALPACA,
  snapAccountId: '51564504-a85f-4dbb-bcf9-6d8d9716596b',
  totalValue: 100_489.34,
  tradingEnabled: true,
  environment: 'paper',
});

const DEMO = entry({ id: 'demo', name: 'Demo Portfolio', isDemo: true, totalValue: 100_000 });

describe('groupLiveAccountsByConnection', () => {
  it('renders ONE card per connection — Fidelity twice would be the bug', () => {
    const cards = groupLiveAccountsByConnection([DEMO, ALPACA_PAPER, FIDELITY_SMA, FIDELITY_YOUTH]);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.connectionId)).toEqual([ALPACA, FIDELITY]);
  });

  it('keeps both Fidelity sub-accounts on their own connection card, each standalone', () => {
    const cards = groupLiveAccountsByConnection([FIDELITY_SMA, FIDELITY_YOUTH, ALPACA_PAPER]);
    const fidelity = cards.find((c) => c.connectionId === FIDELITY)!;
    expect(fidelity.subAccounts.map((s) => s.name)).toEqual([
      'Taxable SMA - US Large Equity',
      'ANIKET -YOUTH ACCOUNT',
    ]);
    expect(fidelity.subAccounts[0].totalValue).toBe(377_551.36);
    expect(fidelity.subAccounts[1].totalValue).toBe(22_803.88);
  });

  it('NEVER sums sub-accounts into a connection total', () => {
    const cards = groupLiveAccountsByConnection([FIDELITY_SMA, FIDELITY_YOUTH]);
    const [fidelity] = cards;
    const summed = 377_551.36 + 22_803.88; // 400,355.24 — the old leaked figure
    const values = fidelity.subAccounts.map((s) => s.totalValue);
    expect(values).not.toContain(summed);
    // and the group carries no aggregate field at all
    expect(fidelity).not.toHaveProperty('totalValue');
    expect(Object.keys(fidelity).sort()).toEqual([
      'brokerName',
      'brokerageSlug',
      'connectionId',
      'environment',
      'subAccounts',
      'tradingEnabled',
    ]);
  });

  it('skips the demo row and any row without a connectionId', () => {
    const orphan = entry({ id: 'snaptrade:unknown', name: 'Orphan', connectionId: undefined });
    const cards = groupLiveAccountsByConnection([DEMO, orphan, ALPACA_PAPER]);
    expect(cards).toHaveLength(1);
    expect(cards[0].connectionId).toBe(ALPACA);
  });

  it('trading is enabled if ANY sub-account on the connection can trade', () => {
    const readonlySibling = { ...FIDELITY_SMA, tradingEnabled: false };
    const cards = groupLiveAccountsByConnection([
      readonlySibling,
      { ...FIDELITY_YOUTH, tradingEnabled: true },
    ]);
    expect(cards[0].tradingEnabled).toBe(true);
  });

  it('environment comes from the connection, not per row', () => {
    const cards = groupLiveAccountsByConnection([ALPACA_PAPER, FIDELITY_SMA]);
    expect(cards.find((c) => c.connectionId === ALPACA)!.environment).toBe('paper');
    expect(cards.find((c) => c.connectionId === FIDELITY)!.environment).toBe('live');
  });

  it('is empty for no accounts — the caller then keeps the legacy single card', () => {
    expect(groupLiveAccountsByConnection([])).toEqual([]);
    expect(groupLiveAccountsByConnection(null)).toEqual([]);
    expect(groupLiveAccountsByConnection(undefined)).toEqual([]);
    expect(groupLiveAccountsByConnection([DEMO])).toEqual([]);
  });

  it('preserves first-seen connection order (matches the switcher)', () => {
    const cards = groupLiveAccountsByConnection([FIDELITY_SMA, ALPACA_PAPER, FIDELITY_YOUTH]);
    expect(cards.map((c) => c.connectionId)).toEqual([FIDELITY, ALPACA]);
  });
});
