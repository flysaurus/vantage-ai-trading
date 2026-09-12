// tests/tax-harvest-origin.test.ts — regression tests for TLH entry-origin
// parsing / routing and the one-shot cancel flash notice.
//
// Run: npx vitest run tests/tax-harvest-origin.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  TLH_PATH,
  TLH_FLASH_KEY,
  TLH_ORIGIN_LABELS,
  tlhEntryPath,
  tlhOriginPath,
  parseTlhOrigin,
  setTlhCancelNotice,
  consumeTlhCancelNotice,
} from '../lib/tax-harvest/origin';
import { TLH_DISCLOSURE_CANCEL_NOTICE } from '../lib/tax-harvest/disclosure';

function makeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

describe('TLH origin helpers', () => {
  beforeEach(() => {
    (globalThis as any).sessionStorage = makeStorage();
    (globalThis as any).window = {};
  });

  it('builds entry paths carrying the origin', () => {
    expect(TLH_PATH).toBe('/strategies/setup/tax-harvesting');
    expect(tlhEntryPath('invest')).toBe(`${TLH_PATH}?from=invest`);
    expect(tlhEntryPath('insights')).toBe(`${TLH_PATH}?from=insights`);
    expect(tlhEntryPath('strategies')).toBe(`${TLH_PATH}?from=strategies`);
  });

  it('maps origins to return paths', () => {
    expect(tlhOriginPath('invest')).toBe('/?tab=invest');
    expect(tlhOriginPath('insights')).toBe('/?tab=insights');
    expect(tlhOriginPath('strategies')).toBe('/strategies');
  });

  it('exposes a human label for every origin', () => {
    expect(TLH_ORIGIN_LABELS.invest).toBe('Invest');
    expect(TLH_ORIGIN_LABELS.insights).toBe('Insights');
    expect(TLH_ORIGIN_LABELS.strategies).toBe('Strategies');
  });

  it('parses valid origins and rejects junk', () => {
    expect(parseTlhOrigin('invest')).toBe('invest');
    expect(parseTlhOrigin('insights')).toBe('insights');
    expect(parseTlhOrigin('strategies')).toBe('strategies');

    expect(parseTlhOrigin('portfolio')).toBeNull();
    expect(parseTlhOrigin('')).toBeNull();
    expect(parseTlhOrigin(null)).toBeNull();
    expect(parseTlhOrigin(undefined)).toBeNull();
    expect(parseTlhOrigin('INVEST')).toBeNull();
    expect(parseTlhOrigin(' invest ')).toBeNull();
  });
});

describe('TLH cancel flash notice', () => {
  beforeEach(() => {
    (globalThis as any).sessionStorage = makeStorage();
    (globalThis as any).window = {};
  });

  it('stores the TLH disclosure notice payload', () => {
    setTlhCancelNotice('insights');
    const raw = sessionStorage.getItem(TLH_FLASH_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed).toEqual({
      kind: 'tlh-disclosure',
      origin: 'insights',
      text: TLH_DISCLOSURE_CANCEL_NOTICE,
    });
  });

  it('consume is one-shot: second call returns null', () => {
    setTlhCancelNotice('invest');
    const first = consumeTlhCancelNotice();
    expect(first).toEqual({ text: TLH_DISCLOSURE_CANCEL_NOTICE, origin: 'invest' });
    expect(consumeTlhCancelNotice()).toBeNull();
    // and it cleared the key
    expect(sessionStorage.getItem(TLH_FLASH_KEY)).toBeNull();
  });

  it('returns null when nothing was stored', () => {
    expect(consumeTlhCancelNotice()).toBeNull();
  });

  it('ignores a notice of a different kind (and clears it)', () => {
    sessionStorage.setItem(
      TLH_FLASH_KEY,
      JSON.stringify({ kind: 'something-else', origin: 'invest', text: 'hi' })
    );
    expect(consumeTlhCancelNotice()).toBeNull();
    expect(sessionStorage.getItem(TLH_FLASH_KEY)).toBeNull();
  });

  it('ignores malformed payloads without throwing', () => {
    sessionStorage.setItem(TLH_FLASH_KEY, '{broken json');
    expect(() => consumeTlhCancelNotice()).not.toThrow();
    expect(consumeTlhCancelNotice()).toBeNull();

    sessionStorage.setItem(
      TLH_FLASH_KEY,
      JSON.stringify({ kind: 'tlh-disclosure', origin: 'bogus' })
    );
    expect(consumeTlhCancelNotice()).toBeNull();
  });

  it('is SSR-safe: without a window both helpers are no-ops', () => {
    const savedWindow = (globalThis as any).window;
    const savedSession = (globalThis as any).sessionStorage;
    (globalThis as any).window = undefined;
    (globalThis as any).sessionStorage = undefined;
    try {
      expect(() => setTlhCancelNotice('invest')).not.toThrow();
      expect(consumeTlhCancelNotice()).toBeNull();
    } finally {
      (globalThis as any).window = savedWindow;
      (globalThis as any).sessionStorage = savedSession;
    }
  });
});
