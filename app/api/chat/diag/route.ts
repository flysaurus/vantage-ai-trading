import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
  
  // Test 1: Does search for "SKHYV" return SK Hynix?
  let searchSkhyv: any = null;
  if (key) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/search?q=SKHYV&token=${key}`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d = await r.json();
        searchSkhyv = { count: d.count, results: (d.result||[]).slice(0,3).map((x:any) => ({ sym: x.symbol, desc: x.description, type: x.type })) };
      } else { searchSkhyv = { error: r.status }; }
    } catch(e: any) { searchSkhyv = { error: e.message }; }
  }

  // Test 2: US_TICKER_RE check on "SKHYV"
  const US_TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
  const regexCheck = { "SKHYV": US_TICKER_RE.test("SKHYV"), "000660.KS": US_TICKER_RE.test("000660.KS") };

  // Test 3: nameOverlaps check
  const queryWords = new Set("SK Hynix".toLowerCase().split(/\s+/).filter((w: string) => w.length > 1));
  const descWords = new Set("SK HYNIX INC-ADR W/I".toLowerCase().split(/\s+/).filter((w: string) => w.length > 1));
  const overlaps = [...queryWords].filter((w: string) => descWords.has(w));
  const nameOverlapCheck = { queryWords: [...queryWords], descWords: [...descWords], overlaps };

  // Test 4: Full resolveSymbol
  let fullResult: any = null;
  try {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    fullResult = JSON.parse(await resolveSymbol('SK Hynix'));
  } catch(e: any) { fullResult = { error: e.message, stack: e.stack?.slice(0,500) }; }

  return NextResponse.json({
    search_for_SKHYV: searchSkhyv,
    usTickerCheck: regexCheck,
    nameOverlapCheck,
    resolveSymbol_full: fullResult,
  });
}
