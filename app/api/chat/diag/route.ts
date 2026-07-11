import { NextResponse } from 'next/server';

export async function GET() {
  const key = process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;

  // Inline generateTickers (exact copy from resolve-symbol.ts)
  function generateTickers(name: string): string[] {
    const clean = name.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/)
      .filter((w: string) => w.length >= 2 && w !== 'THE' && w !== 'AND' && w !== 'INC');
    if (clean.length === 0) return [];

    const set = new Set<string>();
    const add = (s: string) => { if (s.length >= 2 && s.length <= 5) set.add(s); };
    const first = clean[0];
    const last = clean[clean.length - 1];

    for (const w of clean) add(w);
    for (let i = 1; i <= Math.min(4, last.length); i++) add(first + last.slice(0, i));
    const combined = clean.join('');
    for (let i = 2; i <= Math.min(5, combined.length); i++) add(combined.slice(0, i));
    const acronym = clean.map((w: string) => w[0]).join('');
    for (let i = 2; i <= Math.min(5, acronym.length); i++) add(acronym.slice(0, i));
    if (clean.length >= 2 && acronym.length >= 2) {
      for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
        const ext = acronym + trail;
        if (ext.length <= 5) add(ext);
      }
    }
    for (const base of [...set]) { add(base + 'V'); add(base + 'Y'); add(base + 'F'); }

    const compositeSet = new Set<string>();
    for (let i = 1; i <= Math.min(4, last.length); i++) compositeSet.add(first + last.slice(0, i));
    const acroSet = new Set<string>();
    if (clean.length >= 2 && acronym.length >= 2) {
      for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
        const ext = acronym + trail;
        if (ext.length <= 5) acroSet.add(ext);
      }
    }
    for (let i = 2; i <= Math.min(5, acronym.length); i++) acroSet.add(acronym.slice(0, i));
    const compositeAdrSet = new Set<string>();
    for (const base of compositeSet) {
      for (const suffix of ['V', 'Y', 'F']) {
        const candidate = base + suffix;
        if (candidate.length <= 5) compositeAdrSet.add(candidate);
      }
    }

    return [...set].sort((a: string, b: string) => {
      const score = (s: string) => {
        if (compositeAdrSet.has(s)) return 3;
        if (compositeSet.has(s) || acroSet.has(s)) return 2;
        if (s.length >= 3 && /[VYF]$/.test(s)) return 1;
        return 0;
      };
      return score(b) - score(a);
    });
  }

  const candidates = generateTickers('SK Hynix');
  const top15 = candidates.slice(0, 15);
  const skhyvPos = top15.indexOf('SKHYV');

  // Test Finnhub search for "SKHYV"
  let finnhubSkhyv: any = null;
  if (key) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/search?q=SKHYV&token=${key}`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d = await r.json();
        finnhubSkhyv = (d.result || []).slice(0, 3).map((x: any) => ({ sym: x.symbol, desc: x.description, type: x.type }));
      } else { finnhubSkhyv = { error: r.status }; }
    } catch (e: any) { finnhubSkhyv = { error: e.message }; }
  }

  // Test resolveSymbol directly
  let resolveResult: any = null;
  try {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    resolveResult = JSON.parse(await resolveSymbol('SK Hynix'));
  } catch (e: any) { resolveResult = { error: e.message }; }

  return NextResponse.json({
    generateTickers_top15: top15,
    skhyvAtPosition: skhyvPos,
    skhyvPresent: skhyvPos >= 0,
    finnhubForSKHYV: finnhubSkhyv,
    resolveSymbol: resolveResult,
  });
}
