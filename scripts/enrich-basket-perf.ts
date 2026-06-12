/**
 * Basket Performance Enricher — runs on VPS via cron (30 min after basket generation).
 * Fetches Finnhub /stock/metric for each unique stock in active baskets,
 * computes weight-averaged 3m/ytd/1y performance, and updates Supabase.
 *
 * Usage: FINNHUB_IO_API_KEY=xxx tsx scripts/enrich-basket-perf.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ixjnuoslbzytubpplkot.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4am51b3NsYnp5dHVicHBsa290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NjcyNjAsImV4cCI6MjA5MzM0MzI2MH0.VprRiuUDdQDk5R_vE6Gqx9BKfjOQFyUuhrpsD_5BvwY';
const FINNHUB_KEY = process.env.FINNHUB_IO_API_KEY || '';

if (!FINNHUB_KEY) {
  console.error('❌ FINNHUB_IO_API_KEY not set. Export it before running.');
  process.exit(1);
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const supabaseHeaders = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchActiveBaskets() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/baskets?is_active=eq.true&select=id,theme,name,stocks,performance`, {
    headers: supabaseHeaders,
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  const baskets = await res.json();
  return baskets.map((b: any) => ({
    ...b,
    stocks: typeof b.stocks === 'string' ? JSON.parse(b.stocks) : (b.stocks || []),
    performance: typeof b.performance === 'string' ? JSON.parse(b.performance) : (b.performance || {}),
  }));
}

async function fetchStockPerformance(symbol: string) {
  try {
    const [quoteRes, metricRes] = await Promise.allSettled([
      fetch(`${FINNHUB_BASE}/quote?symbol=${symbol}&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${FINNHUB_BASE}/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`, { signal: AbortSignal.timeout(5000) }),
    ]);

    const quote: any = quoteRes.status === 'fulfilled' && quoteRes.value.ok
      ? await quoteRes.value.json() : { c: 0 };
    const metric: any = metricRes.status === 'fulfilled' && metricRes.value.ok
      ? await metricRes.value.json() : { metric: {} };

    const price = quote.c || 0;
    const m = metric.metric || {};
    const r3m = m['13WeekPriceReturnDaily'] || 0;
    const rytd = m.ytdPriceReturnDaily || m.ytdReturnDaily || 0;
    const r1y = m['52WeekPriceReturnDaily'] || 0;

    const best = [{ k: '3m', v: r3m }, { k: 'ytd', v: rytd }, { k: '1y', v: r1y }]
      .sort((a, b) => b.v - a.v)[0].k;

    return { '3m': r3m, ytd: rytd, '1y': r1y, price, best_timeframe: best };
  } catch {
    return { '3m': 0, ytd: 0, '1y': 0, price: 0, best_timeframe: '1y' };
  }
}

async function updateBasketPerformance(basketId: string, performance: any) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/baskets?id=eq.${basketId}`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ performance: JSON.stringify(performance) }),
  });
  if (!res.ok) {
    console.error(`  ⚠️ Failed to update basket ${basketId}: ${res.status}`);
  }
}

async function main() {
  console.log('📊 Basket Performance Enricher\n');

  // 1. Fetch active baskets
  console.log('→ Fetching active baskets...');
  const baskets = await fetchActiveBaskets();
  console.log(`   Found ${baskets.length} active baskets\n`);

  if (baskets.length === 0) {
    console.log('No active baskets to enrich. Done.');
    return;
  }

  // 2. Extract unique stock symbols
  const allSymbols: string[] = [...new Set(
    baskets.flatMap((b: any) => (b.stocks || []).map((s: any) => String(s.symbol || '').toUpperCase()))
  )] as string[];
  console.log(`→ ${allSymbols.length} unique stocks to query (Finnhub /stock/metric)\n`);

  // 3. Fetch performance for all unique stocks concurrently
  const perfMap: Record<string, any> = {};
  const promises = allSymbols.map((sym: string) =>
    fetchStockPerformance(sym).then((p: any) => { perfMap[sym] = p; })
  );
  await Promise.all(promises);

  const withData = Object.entries(perfMap).filter(([, p]) => p['3m'] !== 0 || p.ytd !== 0 || p['1y'] !== 0);
  console.log(`   ${withData.length}/${allSymbols.length} stocks returned real data\n`);

  // 4. Compute basket performance and update
  console.log('→ Computing basket performance & updating Supabase:\n');
  let updated = 0;

  for (const basket of baskets) {
    const stocks = basket.stocks || [];
    const b3m = stocks.reduce((sum: number, s: any) => {
      const p = perfMap[s.symbol.toUpperCase()];
      return sum + ((p?.['3m'] || 0) * (s.allocation / 100));
    }, 0);
    const bytd = stocks.reduce((sum: number, s: any) => {
      const p = perfMap[s.symbol.toUpperCase()];
      return sum + ((p?.ytd || 0) * (s.allocation / 100));
    }, 0);
    const b1y = stocks.reduce((sum: number, s: any) => {
      const p = perfMap[s.symbol.toUpperCase()];
      return sum + ((p?.['1y'] || 0) * (s.allocation / 100));
    }, 0);
    const best = [{ k: '3m', v: b3m }, { k: 'ytd', v: bytd }, { k: '1y', v: b1y }]
      .sort((a, b) => b.v - a.v)[0].k;

    const perf = { '3m': Math.round(b3m * 10) / 10, ytd: Math.round(bytd * 10) / 10, '1y': Math.round(b1y * 10) / 10, best_timeframe: best };

    console.log(`   ${basket.emoji || ''} ${basket.name}`);
    console.log(`      3m: ${perf['3m']}%  ytd: ${perf.ytd}%  1y: ${perf['1y']}%  · best=${best}`);

    await updateBasketPerformance(basket.id, perf);
    updated++;
  }

  console.log(`\n✅ Updated ${updated}/${baskets.length} baskets`);
}

main().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
