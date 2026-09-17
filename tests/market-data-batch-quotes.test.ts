/**
 * getBatchQuotes — enrichment pass semantics.
 *
 * Regression guard for the SMA daily-brief 504: the 52-week range enrichment
 * used to run ONE SYMBOL AT A TIME (finnhub /stock/metric → yahoo chart, plus a
 * 50ms sleep each). For a 349-position account that is minutes of wall clock,
 * which blew the serverless function budget and 504'd /api/ai/daily-brief.
 *
 * Rules under test:
 *   1. `{ enrich: false }` performs ZERO range lookups (briefs don't use them).
 *   2. `{ enrich: true }` (default) still resolves ranges, but with bounded
 *      concurrency instead of strictly one-at-a-time.
 *   3. A resolved range is cached with a long TTL — a second call re-fetches
 *      nothing.
 *   4. A failed enrichment never invents a range (quote passes through as-is).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Call = { url: string };

const env = process.env as Record<string, string | undefined>;

function quotePayload() {
  return { c: 100, d: 1, dp: 1, pc: 99, h: 101, l: 98, o: 99, t: 1_700_000_000 };
}

function metricPayload(high: number, low: number) {
  return { metric: { '52WeekHigh': high, '52WeekLow': low } };
}

function yahooChartPayload(high: number, low: number) {
  return { chart: { result: [{ meta: { fiftyTwoWeekHigh: high, fiftyTwoWeekLow: low } }] } };
}

interface Harness {
  calls: Call[];
  metricCalls: number;
  chartCalls: number;
  /** Peak simultaneous in-flight requests. */
  peakInFlight: number;
  /** Artificial latency so concurrency is observable. */
  latencyMs: number;
  metricResult: (sym: string) => Response | null;
  chartResult: (sym: string) => Response | null;
  /** Status returned by the Finnhub /quote endpoint (429 = rate limited). */
  quoteStatus: number;
  /** Symbols resolved by the Alpaca snapshot fallback. */
  alpacaCalls: number;
}

let h: Harness;

function installFetch() {
  let inFlight = 0;
  vi.stubGlobal('fetch', async (input: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);
    const isEnrichment = url.includes('/api/v1/stock/metric') || url.includes('/v8/finance/chart/');
    if (isEnrichment) {
      inFlight++;
      h.peakInFlight = Math.max(h.peakInFlight, inFlight);
    }
    h.calls.push({ url });
    try {
      if (h.latencyMs) await new Promise((r) => setTimeout(r, h.latencyMs));
      if (url.includes('/api/v1/quote?')) {
        if (h.quoteStatus !== 200) {
          return new Response('{"error":"rate limit"}', {
            status: h.quoteStatus,
            headers: h.quoteStatus === 429 ? { 'retry-after': '60' } : undefined,
          });
        }
        return new Response(JSON.stringify(quotePayload()), { status: 200 });
      }
      if (url.includes('/v2/stocks/snapshots')) {
        h.alpacaCalls++;
        const syms = decodeURIComponent(new URL(url).searchParams.get('symbols') || '')
          .split(',')
          .filter(Boolean);
        const body: Record<string, any> = {};
        for (const s of syms) {
          body[s] = {
            latestTrade: { p: 50 },
            dailyBar: { c: 50, h: 51, l: 49 },
            prevDailyBar: { c: 48 },
          };
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }
      if (url.includes('/api/v1/stock/metric')) {
        h.metricCalls++;
        const sym = new URL(url).searchParams.get('symbol') || '';
        const res = h.metricResult(sym);
        return res ?? new Response(JSON.stringify({ metric: {} }), { status: 200 });
      }
      if (url.includes('/v8/finance/chart/')) {
        h.chartCalls++;
        const sym = decodeURIComponent(url.split('/v8/finance/chart/')[1]?.split('?')[0] || '');
        const res = h.chartResult(sym);
        return res ?? new Response(JSON.stringify({ chart: { result: [] } }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    } finally {
      if (isEnrichment) inFlight--;
    }
  });
}

beforeEach(async () => {
  vi.resetModules();
  env.FINNHUB_IO_API_KEY = 'test-finnhub-key';
  env.ALPACA_API_KEY_ID = 'test-alpaca-key';
  env.ALPACA_SECRET_KEY = 'test-alpaca-secret';
  h = {
    calls: [],
    metricCalls: 0,
    chartCalls: 0,
    peakInFlight: 0,
    latencyMs: 0,
    metricResult: () => null,
    chartResult: () => null,
    quoteStatus: 200,
    alpacaCalls: 0,
  };
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete env.FINNHUB_IO_API_KEY;
  delete env.ALPACA_API_KEY_ID;
  delete env.ALPACA_SECRET_KEY;
});

async function load() {
  return await import('@/lib/market-data');
}

describe('getBatchQuotes enrichment', () => {
  it('skips every range lookup when enrich:false', async () => {
    const { getBatchQuotes } = await load();
    const syms = ['AAA', 'BBB', 'CCC'];

    const quotes = await getBatchQuotes(syms, { enrich: false });

    expect(quotes.size).toBe(3);
    expect(h.metricCalls).toBe(0);
    expect(h.chartCalls).toBe(0);
    // quotes themselves still come back
    expect(quotes.get('AAA')?.price).toBe(100);
    expect(quotes.get('AAA')?.high52w).toBeUndefined();
  });

  it('enriches ranges by default (Finnhub metric first)', async () => {
    const { getBatchQuotes } = await load();
    h.metricResult = () => new Response(JSON.stringify(metricPayload(150, 90)), { status: 200 });

    const quotes = await getBatchQuotes(['DDD', 'EEE']);

    expect(h.metricCalls).toBe(2);
    expect(h.chartCalls).toBe(0);
    expect(quotes.get('DDD')?.high52w).toBe(150);
    expect(quotes.get('EEE')?.low52w).toBe(90);
  });

  it('falls back to the Yahoo chart when the metric has no range', async () => {
    const { getBatchQuotes } = await load();
    h.metricResult = () => new Response(JSON.stringify({ metric: {} }), { status: 200 });
    h.chartResult = () => new Response(JSON.stringify(yahooChartPayload(210, 110)), { status: 200 });

    const quotes = await getBatchQuotes(['FFF']);

    expect(h.metricCalls).toBe(1);
    expect(h.chartCalls).toBe(1);
    expect(quotes.get('FFF')?.high52w).toBe(210);
    expect(quotes.get('FFF')?.low52w).toBe(110);
  });

  it('never invents a range when both sources fail', async () => {
    const { getBatchQuotes } = await load();
    h.metricResult = () => new Response(JSON.stringify({ metric: {} }), { status: 200 });
    h.chartResult = () => new Response('{}', { status: 500 });

    const quotes = await getBatchQuotes(['GGG']);

    expect(quotes.get('GGG')?.price).toBe(100);
    expect(quotes.get('GGG')?.high52w).toBeUndefined();
  });

  it('runs the enrichment pass concurrently, not one symbol at a time', async () => {
    const { getBatchQuotes, __clearRangeCache } = await load();
    __clearRangeCache();
    h.latencyMs = 20;
    h.metricResult = () => new Response(JSON.stringify(metricPayload(150, 90)), { status: 200 });

    // 12 symbols: strictly sequential would peak at 1 in flight; the pass only
    // gates on the per-symbol await, so a batched implementation exceeds that.
    await getBatchQuotes(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9', 'H10', 'H11', 'H12']);

    expect(h.metricCalls).toBe(12);
    expect(h.peakInFlight).toBeGreaterThan(1);
  });

  it('caches a resolved range so a second call re-fetches nothing', async () => {
    const { getBatchQuotes, __clearRangeCache } = await load();
    __clearRangeCache();
    h.metricResult = () => new Response(JSON.stringify(metricPayload(150, 90)), { status: 200 });

    await getBatchQuotes(['III']);
    const afterFirst = h.metricCalls;
    expect(afterFirst).toBe(1);

    // New batch, same symbol, different quote TTL bucket — range must be reused.
    const quotes = await getBatchQuotes(['III']);
    expect(h.metricCalls).toBe(afterFirst);
    expect(quotes.get('III')?.high52w).toBe(150);
  });

  it('honours an explicit concurrency cap of 1', async () => {
    const { getBatchQuotes, __clearRangeCache } = await load();
    __clearRangeCache();
    h.latencyMs = 10;
    h.metricResult = () => new Response(JSON.stringify(metricPayload(150, 90)), { status: 200 });

    await getBatchQuotes(['J1', 'J2', 'J3'], { enrichConcurrency: 1 });

    expect(h.metricCalls).toBe(3);
    expect(h.peakInFlight).toBe(1);
  });
});

describe('getBatchQuotes Finnhub rate limiting', () => {
  it('stops the Finnhub pass on a 429 and hands the rest to Alpaca', async () => {
    const { getBatchQuotes, __resetFinnhubLimit } = await load();
    __resetFinnhubLimit();
    h.quoteStatus = 429;
    const syms = Array.from({ length: 25 }, (_, i) => `K${i}`);

    const quotes = await getBatchQuotes(syms, { enrich: false });

    // One Finnhub batch (10 calls) is attempted, then the cooldown trips and
    // the loop breaks instead of grinding through 3 batches of 429s.
    const fhQuoteCalls = h.calls.filter((c) => c.url.includes('/api/v1/quote?')).length;
    expect(fhQuoteCalls).toBeLessThanOrEqual(10);
    expect(h.alpacaCalls).toBe(1);
    // every symbol still resolved, via the Alpaca batch
    expect(quotes.size).toBe(25);
    expect(quotes.get('K24')?.price).toBe(50);
  });

  it('skips Finnhub entirely while the cooldown is active', async () => {
    const { getBatchQuotes, __resetFinnhubLimit } = await load();
    __resetFinnhubLimit();
    h.quoteStatus = 429;

    await getBatchQuotes(['L1'], { enrich: false });
    const afterFirst = h.calls.filter((c) => c.url.includes('/api/v1/quote?')).length;
    expect(afterFirst).toBeGreaterThan(0);

    // Finnhub is healthy again, but the cooldown is still active → no calls.
    h.quoteStatus = 200;
    const quotes = await getBatchQuotes(['L2'], { enrich: false });

    expect(h.calls.filter((c) => c.url.includes('/api/v1/quote?')).length).toBe(afterFirst);
    expect(quotes.get('L2')?.price).toBe(50); // served by Alpaca
  });

  it('does not trip the cooldown on a healthy Finnhub response', async () => {
    const { getBatchQuotes, __resetFinnhubLimit } = await load();
    __resetFinnhubLimit();
    h.quoteStatus = 200;

    const quotes = await getBatchQuotes(['M1', 'M2'], { enrich: false });

    expect(h.alpacaCalls).toBe(0);
    expect(quotes.get('M1')?.price).toBe(100);
    expect(quotes.get('M2')?.price).toBe(100);
  });

  it('falls through to the Yahoo range fallback while Finnhub is rate limited', async () => {
    const { getBatchQuotes, __clearRangeCache, __resetFinnhubLimit } = await load();
    __clearRangeCache();
    __resetFinnhubLimit();
    // the metric endpoint 429s → cooldown trips → ranges come from Yahoo
    h.metricResult = () =>
      new Response('{}', { status: 429, headers: { 'retry-after': '60' } });
    h.chartResult = () => new Response(JSON.stringify(yahooChartPayload(210, 110)), { status: 200 });

    const quotes = await getBatchQuotes(['N1', 'N2']);

    // Yahoo is the only remaining source, so it is NOT skipped — but the pass
    // is bounded by the deadline rather than by a per-symbol 4s timeout.
    expect(h.chartCalls).toBe(2);
    expect(quotes.get('N1')?.high52w).toBe(210);
    expect(quotes.get('N2')?.low52w).toBe(110);
    expect(quotes.get('N1')?.price).toBe(100);
  });

  it('stops enriching once the wall-clock budget is spent', async () => {
    const { getBatchQuotes, __clearRangeCache, __resetFinnhubLimit } = await load();
    __clearRangeCache();
    __resetFinnhubLimit();
    h.latencyMs = 40;
    h.metricResult = () => new Response(JSON.stringify(metricPayload(150, 90)), { status: 200 });

    const syms = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    const first = await getBatchQuotes(syms, {
      enrichConcurrency: 1,
      enrichDeadlineMs: 120,
    });

    // budget spent part-way through: the tail is deferred, not waited on
    const resolvedFirst = syms.filter((s) => first.get(s)?.high52w != null);
    expect(resolvedFirst.length).toBeGreaterThan(0);
    expect(resolvedFirst.length).toBeLessThan(syms.length);
    const callsAfterFirst = h.metricCalls;

    // a later load resumes where it stopped (resolved ranges are cached, and
    // the pass covers cache-hit quotes too)
    const second = await getBatchQuotes(syms, { enrichDeadlineMs: 0 });
    expect(h.metricCalls).toBeGreaterThan(callsAfterFirst);
    for (const s of syms) expect(second.get(s)?.high52w).toBe(150);
  });
});
