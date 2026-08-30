import { describe, it, expect } from 'vitest';
import { parseAccountScope, accountIdFromScope, applyAccountScopeFilter } from '@/lib/account-scope';

describe('parseAccountScope', () => {
  it('maps demo to isDemo', () => {
    expect(parseAccountScope('demo')).toEqual({ isDemo: true, connectionId: null });
  });

  it('maps a snaptrade account id to its connection uuid', () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(parseAccountScope(`snaptrade:${uuid}`)).toEqual({ isDemo: false, connectionId: uuid });
  });

  it('accepts a bare connection uuid', () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(parseAccountScope(uuid)).toEqual({ isDemo: false, connectionId: uuid });
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
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(parseAccountScope(`SNAPTRADE:${uuid}`)).toEqual({ isDemo: false, connectionId: uuid });
  });
});

describe('accountIdFromScope', () => {
  it('round-trips demo', () => {
    expect(accountIdFromScope({ isDemo: true, connectionId: null })).toBe('demo');
  });
  it('round-trips a connection', () => {
    const uuid = '11111111-2222-4333-8444-555555555555';
    expect(accountIdFromScope({ isDemo: false, connectionId: uuid })).toBe(`snaptrade:${uuid}`);
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
