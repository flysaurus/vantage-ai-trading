import { describe, it, expect } from 'vitest';
import {
  parseAccountScope,
  accountIdFromScope,
  applyAccountScopeFilter,
  connectionIdFromAccountId,
  subAccountId,
} from '@/lib/account-scope';

const UUID = '11111111-2222-4333-8444-555555555555';

describe('parseAccountScope', () => {
  it('maps demo to isDemo', () => {
    expect(parseAccountScope('demo')).toEqual({ isDemo: true, connectionId: null, snapAccountId: null });
  });

  it('maps a snaptrade account id to its connection uuid', () => {
    expect(parseAccountScope(`snaptrade:${UUID}`)).toEqual({
      isDemo: false,
      connectionId: UUID,
      snapAccountId: null,
    });
  });

  it('maps a 3-part sub-account id to connection + sub-account', () => {
    expect(parseAccountScope(`snaptrade:${UUID}:fc-123`)).toEqual({
      isDemo: false,
      connectionId: UUID,
      snapAccountId: 'fc-123',
    });
  });

  it('accepts a bare connection uuid', () => {
    expect(parseAccountScope(UUID)).toEqual({ isDemo: false, connectionId: UUID, snapAccountId: null });
  });

  it('rejects unrecognized / empty input', () => {
    expect(parseAccountScope(null)).toBeNull();
    expect(parseAccountScope(undefined)).toBeNull();
    expect(parseAccountScope('')).toBeNull();
    expect(parseAccountScope('   ')).toBeNull();
    expect(parseAccountScope('snaptrade:not-a-uuid')).toBeNull();
    expect(parseAccountScope('garbage')).toBeNull();
  });

  it('is case-insensitive on the snaptrade prefix', () => {
    expect(parseAccountScope(`SNAPTRADE:${UUID}`)).toEqual({
      isDemo: false,
      connectionId: UUID,
      snapAccountId: null,
    });
  });
});

describe('connectionIdFromAccountId', () => {
  it('extracts the connection id from both 2- and 3-part forms', () => {
    expect(connectionIdFromAccountId(`snaptrade:${UUID}`)).toBe(UUID);
    expect(connectionIdFromAccountId(`snaptrade:${UUID}:fc-123`)).toBe(UUID);
    expect(connectionIdFromAccountId(UUID)).toBe(UUID);
  });
  it('returns null for demo / invalid', () => {
    expect(connectionIdFromAccountId('demo')).toBeNull();
    expect(connectionIdFromAccountId('garbage')).toBeNull();
    expect(connectionIdFromAccountId(null)).toBeNull();
  });
});

describe('accountIdFromScope', () => {
  it('round-trips demo', () => {
    expect(accountIdFromScope({ isDemo: true, connectionId: null })).toBe('demo');
  });
  it('round-trips a connection', () => {
    expect(accountIdFromScope({ isDemo: false, connectionId: UUID })).toBe(`snaptrade:${UUID}`);
  });
  it('round-trips a sub-account', () => {
    expect(accountIdFromScope({ isDemo: false, connectionId: UUID, snapAccountId: 'fc-123' })).toBe(
      `snaptrade:${UUID}:fc-123`,
    );
  });
});

describe('subAccountId', () => {
  it('builds the 2-part form without a sub-account id', () => {
    expect(subAccountId(UUID, null)).toBe(`snaptrade:${UUID}`);
  });
  it('builds the 3-part form with a sub-account id', () => {
    expect(subAccountId(UUID, 'fc-123')).toBe(`snaptrade:${UUID}:fc-123`);
  });
});

describe('applyAccountScopeFilter', () => {
  it('applies is_demo for demo scope', () => {
    const calls: string[] = [];
    const query = { eq: (col: string) => { calls.push(col); return query; } };
    applyAccountScopeFilter(query, { isDemo: true, connectionId: null });
    expect(calls).toEqual(['is_demo']);
  });
  it('applies connection_id for live scope', () => {
    const calls: string[] = [];
    const query = { eq: (col: string) => { calls.push(col); return query; } };
    applyAccountScopeFilter(query, { isDemo: false, connectionId: 'abc' });
    expect(calls).toEqual(['connection_id']);
  });
});
