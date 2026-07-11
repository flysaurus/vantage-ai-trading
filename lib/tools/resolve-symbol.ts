// ─── resolveSymbol Tool — Company Name → Ticker Resolution ──────────────
// Called by Claude via the Anthropic tool-use protocol during chat streaming.
// Resolves a company name to one or more ticker symbols using Finnhub's
// /search endpoint (same source as validate-markers.ts's resolveCompanyTicker).
//
// Result format:
//   match_type: 'single' → one definitive US-listed match
//   match_type: 'multiple' → several candidates, requires user disambiguation
//   match_type: 'none' → no match found, model should tell user to search manually

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

interface FinnhubSearchResult {
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

interface ResolveResult {
  match_type: 'single' | 'multiple' | 'none';
  candidates: Candidate[];
  primary_symbol: string | null;
  query: string;
}

/**
 * Resolve a company name to ticker symbol(s).
 * Returns structured result for Claude to use in building recommendation markers.
 */
export async function resolveSymbol(companyName: string): Promise<string> {
  const key = getApiKey();
  if (!key) {
    return JSON.stringify({
      match_type: 'none',
      candidates: [],
      primary_symbol: null,
      query: companyName,
      error: 'API key not configured',
    });
  }

  try {
    // Step 1: Search Finnhub for the company name
    const searchRes = await fetch(
      `${FINNHUB_BASE}/search?q=${encodeURIComponent(companyName)}&token=${key}`,
    );
    if (!searchRes.ok) {
      return JSON.stringify({
        match_type: 'none',
        candidates: [],
        primary_symbol: null,
        query: companyName,
        error: `Finnhub search failed: ${searchRes.status}`,
      });
    }

    const searchData = await searchRes.json();
    const rawResults: FinnhubSearchResult[] = searchData.result || [];

    if (rawResults.length === 0) {
      return JSON.stringify({
        match_type: 'none',
        candidates: [],
        primary_symbol: null,
        query: companyName,
      });
    }

    // Step 2: Filter to relevant types (US-listed: Common Stock, ETF, ADR, REIT)
    const allowedTypes = new Set(['common stock', 'adr', 'etf', 'reit']);
    const relevant = rawResults.filter((r) => {
      const type = (r.type || '').toLowerCase();
      return allowedTypes.has(type);
    });

    if (relevant.length === 0) {
      return JSON.stringify({
        match_type: 'none',
        candidates: [],
        primary_symbol: null,
        query: companyName,
        note: 'No US-listed ticker found. Consider checking foreign exchanges.',
      });
    }

    // Step 3: Validate top candidates against profile2 for definitive info
    const topResults = relevant.slice(0, 5);
    const candidates: Candidate[] = [];

    for (const r of topResults) {
      try {
        const profileRes = await fetch(
          `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(r.symbol)}&token=${key}`,
        );
        if (profileRes.ok) {
          const profile = await profileRes.json();
          if (profile.name && profile.ticker) {
            candidates.push({
              symbol: profile.ticker,
              name: profile.name,
              exchange: profile.exchange || 'Unknown',
              type: r.type,
            });
          }
        }
      } catch {
        // Fall back to search result data if profile fails
        candidates.push({
          symbol: r.symbol,
          name: r.description || companyName,
          exchange: 'Unknown',
          type: r.type,
        });
      }
    }

    // Deduplicate by symbol
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      if (seen.has(c.symbol)) return false;
      seen.add(c.symbol);
      return true;
    });

    if (unique.length === 0) {
      return JSON.stringify({
        match_type: 'none',
        candidates: [],
        primary_symbol: null,
        query: companyName,
      });
    }

    if (unique.length === 1) {
      return JSON.stringify({
        match_type: 'single',
        candidates: unique,
        primary_symbol: unique[0].symbol,
        query: companyName,
      });
    }

    return JSON.stringify({
      match_type: 'multiple',
      candidates: unique,
      primary_symbol: null,
      query: companyName,
    });
  } catch (err: any) {
    console.error('[resolveSymbol] Error:', err.message || err);
    return JSON.stringify({
      match_type: 'none',
      candidates: [],
      primary_symbol: null,
      query: companyName,
      error: err.message || 'Unknown error',
    });
  }
}
