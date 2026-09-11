// ─── Regression: "Today $0.00" fabricated-flat-day bug ───────────────────
// Root cause: `positionDayChange` used to return {dayChange: 0} whenever a
// Finnhub quote was missing (429 / silent skip), and `fetchFinnhubQuotes` had
// no concurrency limit, no retry and no fallback — so a cold Holdings load
// tripped the free-tier cap and every symbol silently became a flat $0.00.
//
// These tests lock in the fix:
//   1. a missing/unavailable quote must produce dayChange: null, NOT 0;
//   2. a real flat day (quote EXISTS, change is 0) stays numeric 0;
//   3. a mocked Finnhub 429 retries and then falls through to the next source;
//   4. a symbol with no source at all is OMITTED (unavailable), never zeroed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/market-data', () => ({
  alpacaQuote: vi.fn(async () => null),
  yahooQuote: vi.fn(async () => null),
}));

import { alpacaQuote, yahooQuote } from '@/lib/market-data';
import { fetchFinnhubQuotes, positionDayChange } from '@/lib/finnhub-quote';

const alpacaMock = vi.mocked(alpacaQuote);
const yahooMock = vi.mocked(yahooQuote);

/** Minimal generic Quote (matches lib/market-data `Quote`). */
function quote(symbol: string, price: number, previousClose: number, source: 'alpaca' | 'yahoo' = 'alpaca') {
  return {
    symbol,
    price,
    change: +(price - previousClose).toFixed(4),
    changePercent: previousClose ? +(((price - previousClose) / previousClose) * 100).toFixed(4) : 0,
    previousClose,
    high: price,
    low: price,
    open: price,
    source,
    timestamp: Date.now(),
  } as any;
}

/** Tiny Retry-After so the retry test stays fast (still exercises the path). */
function finnhubOk(payload: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => payload,
  } as unknown as Response;
}

function finnhub429(retryAfter = '0.05') {
  return {
    ok: false,
    status: 429,
    headers: new Headers({ 'retry-after': retryAfter }),
    json: async () => ({ error: 'Too many requests. Please try again later.' }),
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.FINNHUB_IO_API_KEY = 'test-key';
  alpacaMock.mockReset().mockResolvedValue(null);
  yahooMock.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. positionDayChange null semantics ──────────────────────────────────

describe('positionDayChange — missing vs flat', () => {
  it('returns NULL (unavailable) when no quote exists — never a fabricated 0', () => {
    expect(positionDayChange(10, undefined)).toEqual({ dayChange: null, dayChangePct: null });
    expect(positionDayChange(10, null)).toEqual({ dayChange: null, dayChangePct: null });
  });

  it('returns NULL when the quote has no usable price/prev-close', () => {
    expect(positionDayChange(10, { c: 0, pc: 0, d: 0, dp: 0 })).toEqual({ dayChange: null, dayChangePct: null });
    expect(positionDayChange(10, { c: 150, pc: 0, d: 0, dp: 0 })).toEqual({ dayChange: null, dayChangePct: null });
  });

  it('preserves a REAL flat day (quote exists, change is 0) as numeric 0', () => {
    const r = positionDayChange(10, { c: 100, pc: 100, d: 0, dp: 0 });
    expect(r).toEqual({ dayChange: 0, dayChangePct: 0 });
  });

  it('computes dollars + percent from current − previousClose', () => {
    const r = positionDayChange(10, { c: 99, pc: 100, d: -1, dp: -1 });
    expect(r.dayChange).toBeCloseTo(-10, 6);
    expect(r.dayChangePct).toBeCloseTo(-1, 6);
  });
});

// ── 2. fetchFinnhubQuotes fallback chain + 429 retry ────────────────────

describe('fetchFinnhubQuotes — fallback chain on 429', () => {
  it('retries a 429 (honouring Retry-After) then falls through to Alpaca', async () => {
    fetchMock.mockResolvedValue(finnhub429());
    alpacaMock.mockResolvedValue(quote('AAA', 101, 100, 'alpaca'));

    const map = await fetchFinnhubQuotes(['AAA']);

    // Finnhub was attempted twice (initial + 1 retry) before falling through.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(alpacaMock).toHaveBeenCalledWith('AAA');
    expect(map.AAA).toBeTruthy();
    expect(map.AAA.pc).toBe(100);
    expect(map.AAA.c).toBe(101);
  });

  it('falls through Finnhub → Alpaca → Yahoo when earlier sources fail', async () => {
    fetchMock.mockResolvedValue(finnhub429());
    alpacaMock.mockResolvedValue(null);
    yahooMock.mockResolvedValue(quote('BBB', 52, 50, 'yahoo'));

    const map = await fetchFinnhubQuotes(['BBB']);

    expect(yahooMock).toHaveBeenCalledWith('BBB');
    expect(map.BBB).toBeTruthy();
    expect(map.BBB.c).toBe(52);
  });

  it('OMITS symbols that no source can resolve — never zeroes them', async () => {
    fetchMock.mockResolvedValue(finnhub429());
    alpacaMock.mockResolvedValue(null);
    yahooMock.mockResolvedValue(null);

    const map = await fetchFinnhubQuotes(['DEAD1']);

    expect('DEAD1' in map).toBe(false);
    // End-to-end: the missing symbol must produce the unavailable result, NOT 0.
    expect(positionDayChange(5, map.DEAD1)).toEqual({ dayChange: null, dayChangePct: null });
  });

  it('serves a good Finnhub 200 and does not fall through', async () => {
    fetchMock.mockResolvedValue(finnhubOk({ c: 210, pc: 200, d: 10, dp: 5 }));
    const map = await fetchFinnhubQuotes(['CCC']);
    expect(map.CCC).toEqual({ c: 210, pc: 200, d: 10, dp: 5 });
    expect(alpacaMock).not.toHaveBeenCalled();
    expect(yahooMock).not.toHaveBeenCalled();
  });
});

// ── 3. cache holds the unavailable state without poisoning real quotes ──

describe('fetchFinnhubQuotes — cache', () => {
  it('caches the unavailable state (no re-fetch within TTL) without zeroing', async () => {
    fetchMock.mockResolvedValue(finnhub429());
    alpacaMock.mockResolvedValue(null);
    yahooMock.mockResolvedValue(null);

    await fetchFinnhubQuotes(['NOCACHE1']);
    const callsAfterFirst = fetchMock.mock.calls.length;

    const second = await fetchFinnhubQuotes(['NOCACHE1']);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // served from cache
    expect('NOCACHE1' in second).toBe(false);
    expect(positionDayChange(1, second.NOCACHE1).dayChange).toBeNull();
  });

  it('a real cached quote is never overwritten by an unavailable marker', async () => {
    fetchMock.mockResolvedValue(finnhubOk({ c: 300, pc: 290, d: 10, dp: 3.4 }));
    const first = await fetchFinnhubQuotes(['GOODCACHE']);
    expect(first.GOODCACHE.c).toBe(300);

    // Second call: even if the network would now 429, the cached real quote wins.
    fetchMock.mockResolvedValue(finnhub429());
    const second = await fetchFinnhubQuotes(['GOODCACHE']);
    expect(second.GOODCACHE.c).toBe(300);
  });
});
