// ─── resolveSymbol Tool — Company Name → Ticker Resolution ──────────────
// Called by Claude via the Anthropic tool-use protocol during chat streaming.
//
// Two-phase strategy:
//   1. Finnhub /search by company name (works for US stocks, ETFs).
//   2. If Phase 1 returns nothing, generate plausible US ticker patterns
//      from the company name and search each pattern on Finnhub.
//      This catches OTC ADRs (e.g., SKHYV for "SK Hynix") that Finnhub
//      misses in company-name searches.
//
// Every result is filtered to US-format tickers only: 1-5 uppercase letters,
// optional 1-letter suffix (e.g., AAPL, BRK.B, SKHYV).
// Foreign tickers like 000660.KS, 9988.HK are rejected.
//
// Result format:
//   match_type: 'single'  → one definitive US-listed match
//   match_type: 'multiple' → several candidates, needs disambiguation
//   match_type: 'none'     → no US match found

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const US_TICKER_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;
const ALLOWED_TYPES = new Set(['common stock', 'adr', 'etf', 'reit']);

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

interface RawResult {
  symbol: string;
  description: string;
  type: string;
  displaySymbol: string;
}

interface Candidate {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

/** Generate plausible US ticker patterns from a company name. */
function generateTickers(name: string): string[] {
  const clean = name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && w !== 'THE' && w !== 'AND' && w !== 'INC');

  if (clean.length === 0) return [];

  const set = new Set<string>();
  const add = (s: string) => { if (s.length >= 2 && s.length <= 5) set.add(s); };
  const first = clean[0];
  const last = clean[clean.length - 1];

  // Single words as-is
  for (const w of clean) add(w);

  // First word + first chars of last word: SK+H=SKH, SK+HY=SKHY, SK+HYN=SKHYN
  for (let i = 1; i <= Math.min(4, last.length); i++) add(first + last.slice(0, i));

  // First N chars of combined name: SK, SKH, SKHY, SKHYN
  const combined = clean.join('');
  for (let i = 2; i <= Math.min(5, combined.length); i++) add(combined.slice(0, i));

  // Acronym from first letters: Taiwan Semiconductor → TS, TSM, TSMC
  const acronym = clean.map(w => w[0]).join('');
  for (let i = 2; i <= Math.min(5, acronym.length); i++) add(acronym.slice(0, i));

  // Extended acronym for partial names: "Taiwan Semiconductor" → TSM
  if (clean.length >= 2 && acronym.length >= 2) {
    for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
      const ext = acronym + trail;
      if (ext.length <= 5) add(ext);
    }
  }

  // ADR suffixes (V, Y, F)
  for (const base of [...set]) {
    add(base + 'V');
    add(base + 'Y');
    add(base + 'F');
  }

  // ── Prioritization ──────────────────────────────────────
  // Build sets for different priority tiers:
  //   Tier 3: ADR-suffixed composite prefixes (SKHYV, TSMY — most likely ADR matches)
  //   Tier 2: Composite prefixes (SKHY, TSM) + acronym-based (SH, SHM)
  //   Tier 1: Other ADR-suffixed (SKV, HYNIXV)
  //   Tier 0: Everything else (SK, HYNIX, SKH)

  // Tier 2 baseline: composite (1st-word + last-word prefix) patterns
  const compositeSet = new Set<string>();
  for (let i = 1; i <= Math.min(4, last.length); i++) {
    compositeSet.add(first + last.slice(0, i));
  }
  // Tier 2: acronym-based expansions
  const acroSet = new Set<string>();
  if (clean.length >= 2 && acronym.length >= 2) {
    for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
      const ext = acronym + trail;
      if (ext.length <= 5) acroSet.add(ext);
    }
  }
  for (let i = 2; i <= Math.min(5, acronym.length); i++) acroSet.add(acronym.slice(0, i));

  // Tier 3: ADR-suffixed composite patterns (top priority — these are the best ADR matches)
  const compositeAdrSet = new Set<string>();
  for (const base of compositeSet) {
    for (const suffix of ['V', 'Y', 'F']) {
      const candidate = base + suffix;
      if (candidate.length <= 5) compositeAdrSet.add(candidate);
    }
  }

  return [...set].sort((a, b) => {
    const score = (s: string) => {
      if (compositeAdrSet.has(s)) return 3;  // composite ADR (SKHYV, TSMY)
      if (compositeSet.has(s) || acroSet.has(s)) return 2;  // composite/acronym base
      if (s.length >= 3 && /[VYF]$/.test(s)) return 1;  // other ADR
      return 0;
    };
    return score(b) - score(a);
  });
}

/** Search Finnhub and return US-format results only. */
async function searchFinnhub(query: string, key: string): Promise<RawResult[]> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/search?q=${encodeURIComponent(query)}&token=${key}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.result || []).filter((r: RawResult) =>
      US_TICKER_RE.test(r.symbol || '') && ALLOWED_TYPES.has((r.type || '').toLowerCase()),
    );
  } catch {
    return [];
  }
}

/** Check if search result description overlaps company name query. */
function nameOverlaps(result: RawResult, companyName: string): boolean {
  const desc = (result.description || '').toLowerCase();
  const query = companyName.toLowerCase();
  const queryWords = new Set(query.split(/\s+/).filter(w => w.length > 1));
  const descWords = new Set(desc.split(/\s+/).filter(w => w.length > 1));
  return [...queryWords].filter(w => descWords.has(w)).length > 0;
}

/** Enrich a result with profile2 data; falls back to search data for OTC.
 * Returns null if the stock is confirmed delisted, bankrupt, or has no exchange. */
async function enrich(r: RawResult, key: string): Promise<Candidate | null> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(r.symbol)}&token=${key}`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (res.ok) {
      const p = await res.json();
      if (p.name && p.ticker && US_TICKER_RE.test(p.ticker || '')) {
        // ── Delisting guard: reject symbols with null/empty exchange ──
        // Finnhub returns exchange=null or exchange='' for delisted/bankrupt stocks
        // (e.g., AFIIQ — Armstrong Flooring Inc, delisted after Chapter 11).
        // Also reject known OTC-markets that host bankrupt shells.
        const exchange = (p.exchange || '').trim();
        if (!exchange) {
          console.warn(`[resolveSymbol] Rejected ${r.symbol}: empty exchange (likely delisted/bankrupt)`);
          return null;
        }
        // Additional safety: Finnhub sometimes returns stale profiles where
        // the ticker field doesn't match the search result. Filter those.
        if (p.ticker !== r.symbol && p.ticker !== r.displaySymbol) {
          console.warn(`[resolveSymbol] Rejected ${r.symbol}: profile ticker mismatch (${p.ticker})`);
          return null;
        }
        return { symbol: p.ticker, name: p.name, exchange: p.exchange || 'Unknown', type: r.type };
      }
    }
  } catch { /* fall through */ }
  // ── Fallback: use search result data but check for minimum viability ──
  const symbol = r.symbol;
  // Reject symbols that look like OTC bankrupt shells:
  //   - 5-character tickers ending in Q (Chapter 11 bankruptcy indicator)
  if (symbol.length === 5 && symbol.endsWith('Q')) {
    console.warn(`[resolveSymbol] Rejected ${symbol}: ends with Q (bankruptcy indicator)`);
    return null;
  }
  return { symbol: r.symbol, name: r.description || '', exchange: 'Unknown', type: r.type };
}

export async function resolveSymbol(companyName: string): Promise<string> {
  const key = getApiKey();
  if (!key) {
    return JSON.stringify({
      match_type: 'none', candidates: [], primary_symbol: null,
      query: companyName, error: 'API key not configured',
    });
  }

  try {
    // Phase 1: Direct company-name search (works for US stocks, ETFs)
    let results = await searchFinnhub(companyName, key);

    // Phase 2: Ticker-generation fallback (catches OTC ADRs)
    if (results.length === 0) {
      const tickers = generateTickers(companyName).slice(0, 15);
      if (tickers.length > 0) {
        const seen = new Set<string>();
        for (let ti = 0; ti < tickers.length; ti++) {
          if (ti > 0) await new Promise(r => setTimeout(r, 300));
          const batch = await searchFinnhub(tickers[ti], key);
          for (const r of batch) {
            if (!seen.has(r.symbol) && nameOverlaps(r, companyName)) {
              seen.add(r.symbol);
              results.push(r);
            }
          }
        }
      }
    }

    if (results.length === 0) {
      return JSON.stringify({
        match_type: 'none', candidates: [], primary_symbol: null,
        query: companyName,
      });
    }

    // Phase 3: Enrich with profile data
    const top = results.slice(0, 5);
    const enriched = (await Promise.all(top.map(r => enrich(r, key))))
      .filter((c): c is Candidate => c !== null);

    if (enriched.length === 1) {
      return JSON.stringify({
        match_type: 'single',
        candidates: enriched,
        primary_symbol: enriched[0].symbol,
        query: companyName,
      });
    }

    return JSON.stringify({
      match_type: 'multiple',
      candidates: enriched,
      primary_symbol: null,
      query: companyName,
    });
  } catch (err: any) {
    return JSON.stringify({
      match_type: 'none', candidates: [], primary_symbol: null,
      query: companyName, error: err.message || 'Unknown error',
    });
  }
}
