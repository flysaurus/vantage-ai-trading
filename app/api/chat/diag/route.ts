// GET /api/chat/diag — Returns tool-calling deployment status
import { NextResponse } from 'next/server';

export async function GET() {
  const hasFinnhubKey = !!(process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY);
  const key = process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
  
  // Phase 1: direct search
  let phase1: any = null;
  if (key) {
    try {
      const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent('SK Hynix')}&token=${key}`);
      const d = await r.json();
      phase1 = { count: (d.result||[]).length, first3: (d.result||[]).slice(0,3).map((x:any) => x.symbol) };
    } catch (e: any) { phase1 = { error: e.message }; }
  }

  // Phase 2: ticker generation
  const cleanName = 'SK Hynix'.toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').split(/\s+/).filter((w: string) => w.length >= 2 && w !== 'THE');
  const first = cleanName[0], last = cleanName[cleanName.length-1];
  const combined = cleanName.join('');
  const acronym = cleanName.map((w: string) => w[0]).join('');
  
  const set = new Set<string>();
  const add = (s: string) => { if (s.length >= 2 && s.length <= 5) set.add(s); };
  for (const w of cleanName) add(w);
  for (let i = 1; i <= Math.min(4, last.length); i++) add(first + last.slice(0, i));
  for (let i = 2; i <= Math.min(5, combined.length); i++) add(combined.slice(0, i));
  for (let i = 2; i <= Math.min(5, acronym.length); i++) add(acronym.slice(0, i));
  if (cleanName.length >= 2 && acronym.length >= 2) {
    for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
      const ext = acronym + trail;
      if (ext.length <= 5) add(ext);
    }
  }
  for (const base of [...set]) { add(base + 'V'); add(base + 'Y'); add(base + 'F'); }
  
  const candidates = [...set].slice(0, 12);

  // Test Phase 2: search each candidate
  let phase2: any = { candidates, results: [] as any[] };
  if (key) {
    const seen = new Set<string>();
    for (let ti = 0; ti < candidates.length; ti++) {
      if (ti > 0) await new Promise(r => setTimeout(r, 300));
      try {
        const r = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(candidates[ti])}&token=${key}`);
        if (r.ok) {
          const d = await r.json();
          for (const item of (d.result || [])) {
            if (!seen.has(item.symbol)) {
              seen.add(item.symbol);
              phase2.results.push({ ticker: item.symbol, desc: item.description, type: item.type, searched_for: candidates[ti] });
            }
          }
        }
      } catch(e) {}
    }
  }
  
  // Full resolveSymbol
  let fullResult: any = null;
  try {
    const { resolveSymbol } = await import('@/lib/tools/resolve-symbol');
    const result = await resolveSymbol('SK Hynix');
    fullResult = JSON.parse(result);
  } catch (e: any) { fullResult = { error: e.message }; }

  return NextResponse.json({
    deployed: true,
    finnhubKey: hasFinnhubKey,
    phase1_finnhub_search: phase1,
    phase2_candidates: phase2.candidates,
    phase2_results: phase2.results,
    resolveSymbol_full: fullResult,
  });
}
