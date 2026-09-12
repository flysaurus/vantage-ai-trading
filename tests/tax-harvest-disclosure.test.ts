// tests/tax-harvest-disclosure.test.ts — regression tests for the versioned,
// per-account TLH disclosure acceptance store.
//
// Run: npx vitest run tests/tax-harvest-disclosure.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TLH_DISCLOSURE_VERSION,
  TLH_STORAGE_KEY,
  getDisclosureRecord,
  isDisclosureAccepted,
  acceptDisclosure,
  clearDisclosure,
} from '../lib/tax-harvest/disclosure';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

describe('TLH disclosure acceptance store', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = makeStorage();
    (globalThis as any).window = {};
  });

  it('starts unaccepted and creates an ISO-dated record on accept', () => {
    expect(isDisclosureAccepted('acct-1')).toBe(false);
    expect(getDisclosureRecord('acct-1')).toBeNull();

    const record = acceptDisclosure('acct-1');
    expect(record.accountId).toBe('acct-1');
    expect(record.version).toBe(TLH_DISCLOSURE_VERSION);
    expect(Number.isNaN(Date.parse(record.acceptedAt))).toBe(false);

    expect(isDisclosureAccepted('acct-1')).toBe(true);
  });

  it('is per-account: accepting one account does not accept another', () => {
    acceptDisclosure('acct-1');
    expect(isDisclosureAccepted('acct-1')).toBe(true);
    expect(isDisclosureAccepted('acct-2')).toBe(false);
    expect(getDisclosureRecord('acct-2')).toBeNull();
  });

  it('clearDisclosure removes only the named account', () => {
    acceptDisclosure('acct-1');
    acceptDisclosure('acct-2');
    clearDisclosure('acct-1');
    expect(isDisclosureAccepted('acct-1')).toBe(false);
    expect(isDisclosureAccepted('acct-2')).toBe(true);
  });

  it('a stored record with a different version is NOT accepted (gate re-fires)', () => {
    // Simulate an acceptance made against older copy.
    const stale = {
      'acct-1': {
        accountId: 'acct-1',
        version: 'v0',
        acceptedAt: new Date().toISOString(),
      },
    };
    localStorage.setItem(TLH_STORAGE_KEY, JSON.stringify(stale));

    // The record is still readable, but the version mismatch defeats acceptance.
    expect(getDisclosureRecord('acct-1')?.version).toBe('v0');
    expect(isDisclosureAccepted('acct-1')).toBe(false);

    // Re-accepting writes the current version.
    acceptDisclosure('acct-1');
    expect(isDisclosureAccepted('acct-1')).toBe(true);
  });

  it('missing JSON degrades to "not accepted"', () => {
    expect(isDisclosureAccepted('acct-1')).toBe(false);
    expect(getDisclosureRecord('acct-1')).toBeNull();
  });

  it('corrupt JSON degrades to "not accepted" and never throws', () => {
    localStorage.setItem(TLH_STORAGE_KEY, '{not valid json');
    expect(() => isDisclosureAccepted('acct-1')).not.toThrow();
    expect(isDisclosureAccepted('acct-1')).toBe(false);
    expect(getDisclosureRecord('acct-1')).toBeNull();
  });

  it('non-object / array JSON payloads degrade to "not accepted"', () => {
    localStorage.setItem(TLH_STORAGE_KEY, '["nope"]');
    expect(isDisclosureAccepted('acct-1')).toBe(false);
    localStorage.setItem(TLH_STORAGE_KEY, 'null');
    expect(isDisclosureAccepted('acct-1')).toBe(false);
  });

  it('is SSR-safe: without a window it reports not accepted', () => {
    // Simulate a server render — no window, no localStorage.
    const savedWindow = (globalThis as any).window;
    const savedStorage = (globalThis as any).localStorage;
    (globalThis as any).window = undefined;
    (globalThis as any).localStorage = undefined;
    try {
      expect(isDisclosureAccepted('acct-1')).toBe(false);
      expect(getDisclosureRecord('acct-1')).toBeNull();
      // accept/clear must not throw even without storage.
      expect(() => acceptDisclosure('acct-1')).not.toThrow();
      expect(() => clearDisclosure('acct-1')).not.toThrow();
    } finally {
      (globalThis as any).window = savedWindow;
      (globalThis as any).localStorage = savedStorage;
    }
  });

  it('swallows quota / write errors without throwing', () => {
    (globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
      removeItem: () => {},
      clear: () => {},
    };
    expect(() => acceptDisclosure('acct-1')).not.toThrow();
    // record is still returned even though persistence failed
    expect(acceptDisclosure('acct-1').accountId).toBe('acct-1');
  });
});
