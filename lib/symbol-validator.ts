// ─── Symbol Validator — Cached US Stock Ticker List ──────────────────────
// Fetches all US-listed stock symbols from Finnhub once, caches in memory
// for 24 hours. Used to validate candidate symbols before rendering trade
// buttons — eliminates false positives from "I", "A", common words, etc.
//
// Finnhub endpoints: GET /stock/symbol?exchange=US (+ OTC fallback)
// Returns ~18,000+ symbols. Cache size: ~2MB raw, ~0.5MB as Set<string>.
//
// Refresh schedule: every 24 hours (or on first request after cold start).
//
// Exchange coverage: 'US' (NYSE/NASDAQ/AMEX/BATS/IEX) + 'OTC' (OTC Markets)
// This ensures ADR tickers like SKHYV are included in the client-side validSymbols set.

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

interface FinnhubSymbol {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

let _symbolCache: Set<string> | null = null;
let _symbolNameMap: Map<string, string> | null = null; // symbol → description
let _lastFetchTime = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 15000; // Finnhub symbol list is large

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

export async function loadSymbolCache(): Promise<Set<string>> {
  const now = Date.now();

  // Return existing cache if fresh
  if (_symbolCache && (now - _lastFetchTime) < CACHE_TTL_MS) {
    return _symbolCache;
  }

  const key = getApiKey();
  if (!key) {
    console.warn('[symbol-validator] No Finnhub API key found — validation disabled');
    return new Set(); // Empty = no validation (allow all)
  }

  try {
    console.log('[symbol-validator] Fetching US stock symbol list from Finnhub...');
    // Fetch from multiple exchange codes to cover both major exchanges and OTC
    // (OTC ensures ADR tickers like SKHYV are included in the client-side validSymbols)
    const exchangeCodes = ['US', 'OTC'];
    const symbols = new Set<string>();
    const symbolNameMap = new Map<string, string>(); // symbol → description
    const allowedTypes = new Set(['common stock', 'etf', 'adr', 'reit', 'unit', 'closed-end fund']);

    for (const exchange of exchangeCodes) {
      try {
        console.log(`[symbol-validator] Fetching symbols from exchange=${exchange}...`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const res = await fetch(
          `${FINNHUB_BASE}/stock/symbol?exchange=${exchange}&token=${key}`,
          { signal: controller.signal },
        );
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`[symbol-validator] exchange=${exchange} returned ${res.status} — skipping`);
          continue;
        }

        const data: FinnhubSymbol[] = await res.json();
        if (!Array.isArray(data)) {
          console.warn(`[symbol-validator] exchange=${exchange} unexpected response — skipping`);
          continue;
        }

        let added = 0;
        for (const item of data) {
          const sym = (item.symbol || '').toUpperCase().trim();
          const type = (item.type || '').toLowerCase();
          if (sym && allowedTypes.has(type) && !symbols.has(sym)) {
            symbols.add(sym);
            // Store description for company name search fallback
            if (item.description) {
              symbolNameMap.set(sym, item.description);
            }
            added++;
          }
        }
        console.log(`[symbol-validator] exchange=${exchange}: +${added} symbols (total: ${symbols.size.toLocaleString()})`);
      } catch (err: any) {
        if (err.name === 'AbortError') {
          console.warn(`[symbol-validator] exchange=${exchange} timed out — skipping`);
        } else {
          console.warn(`[symbol-validator] exchange=${exchange} fetch error: ${err.message || err} — skipping`);
        }
      }
    }

    _symbolCache = symbols;
    _symbolNameMap = symbolNameMap;
    _lastFetchTime = now;
    console.log(`[symbol-validator] Cached ${symbols.size.toLocaleString()} valid US symbols (24h TTL) with ${symbolNameMap.size.toLocaleString()} name mappings`);

    // ── Cache health check ──
    const HEALTH_THRESHOLD = 5000; // minimum expected US symbols
    const CRITICAL_ETFS = ['VOO', 'QQQ', 'SPY', 'SCHD', 'VTI', 'IVV', 'VEA', 'BND', 'VGT', 'XLK'];
    const missingEtfs = CRITICAL_ETFS.filter(s => !symbols.has(s));
    
    if (symbols.size < HEALTH_THRESHOLD) {
      console.error(`[symbol-validator] ⚠️ HEALTH WARNING: Symbol cache only has ${symbols.size.toLocaleString()} entries (threshold: ${HEALTH_THRESHOLD.toLocaleString()}). Finnhub response may be incomplete — live lookups will be used as fallback.`);
    }
    if (missingEtfs.length > 0) {
      console.error(`[symbol-validator] ⚠️ HEALTH WARNING: ${missingEtfs.length} critical ETFs missing from cache: ${missingEtfs.join(', ')}. These will require live Finnhub lookups during validation.`);
      if (missingEtfs.length >= 5) {
        console.error('[symbol-validator] 🔴 SEVERE: More than half of critical ETFs missing — Finnhub API key may be expired or rate-limited.');
      }
    }
    if (symbols.size >= HEALTH_THRESHOLD && missingEtfs.length === 0) {
      console.log('[symbol-validator] ✅ Cache health check passed — size OK, critical ETFs present');
    }

    return symbols;
  } catch (err: any) {
    console.error('[symbol-validator] Failed to load symbol cache:', err.message || err);
    return _symbolCache || new Set(); // Return stale cache or empty
  }
}

/** Validate a single symbol against the cached list. Returns true if valid. */
export async function isValidSymbol(symbol: string): Promise<boolean> {
  const cache = await loadSymbolCache();
  if (cache.size === 0) return true; // No cache = skip validation (allow all)
  return cache.has(symbol.toUpperCase().trim());
}

/** Validate multiple symbols. Returns only those that are valid tickers. */
export async function filterValidSymbols(candidates: string[]): Promise<string[]> {
  const cache = await loadSymbolCache();
  if (cache.size === 0) return candidates; // No cache = skip validation (allow all)
  return candidates.filter(s => cache.has(s.toUpperCase().trim()));
}

/** Get the full symbol set AND name map (for client-side one-time loading). */
export async function getCachedSymbols(): Promise<{
  symbols: string[];
  symbolNames: Map<string, string>;
}> {
  const cache = await loadSymbolCache();
  return {
    symbols: Array.from(cache).sort(),
    symbolNames: _symbolNameMap || new Map(),
  };
}

/** Force refresh the symbol cache (e.g., from a cron job). */
export async function refreshSymbolCache(): Promise<Set<string>> {
  _lastFetchTime = 0; // Force re-fetch
  return loadSymbolCache();
}

/**
 * Search the cached symbol list by company name / description substring.
 * Used as fallback when Finnhub /search returns empty for company names
 * (e.g. "SK Hynix" → SKHYV, "Taiwan Semiconductor" → TSM).
 *
 * Returns up to `limit` results, scored by substring match quality.
 */
export async function searchSymbolsByName(
  query: string,
  limit: number = 10,
): Promise<Array<{ symbol: string; name: string; score: number }>> {
  await loadSymbolCache(); // ensure cache is loaded
  if (!_symbolNameMap || _symbolNameMap.size === 0) return [];

  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];

  const results: Array<{ symbol: string; name: string; score: number }> = [];

  for (const [symbol, name] of _symbolNameMap) {
    const nameLower = name.toLowerCase();
    let score = 0;

    // Exact match on full query
    if (nameLower === q) {
      score = 100;
    } else if (nameLower.startsWith(q)) {
      score = 80;
    } else if (nameLower.includes(q)) {
      score = 60;
    } else {
      // Match individual words — each matched word adds points
      let matchedWords = 0;
      for (const word of words) {
        if (nameLower.includes(word)) matchedWords++;
      }
      if (matchedWords === 0) continue;
      score = matchedWords * 15; // 15-45 points depending on word match count
    }

    // Bonus: symbol starts with query prefix (e.g. query "TSM" matches symbol "TSM")
    if (symbol.toLowerCase().startsWith(q)) {
      score += 10;
    }

    results.push({ symbol, name, score });
  }

  // Sort by score descending, take top results
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/**
 * Look up display names for symbols. Checks the in-memory cache first;
 * for symbols NOT in the cache, does a live Finnhub profile lookup.
 * Returns a Map of symbol → name (only for symbols that have names).
 */
export async function lookupSymbolNames(symbols: string[]): Promise<Map<string, string>> {
  await loadSymbolCache();
  const result = new Map<string, string>();
  const missing: string[] = [];

  for (const sym of symbols) {
    const upper = sym.toUpperCase().trim();
    const cached = _symbolNameMap?.get(upper);
    if (cached) {
      result.set(upper, cached);
    } else {
      missing.push(upper);
    }
  }

  // For symbols not in cache, try live Finnhub profile lookup
  if (missing.length > 0) {
    const token = process.env.FINNHUB_IO_API_KEY;
    if (token) {
      for (const sym of missing.slice(0, 5)) { // cap live lookups at 5
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(
            `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${token}`,
            { signal: controller.signal },
          );
          clearTimeout(timeout);
          if (res.ok) {
            const profile = await res.json();
            if (profile?.name) {
              result.set(sym, profile.name);
              // Also cache it for future lookups
              if (_symbolNameMap) _symbolNameMap.set(sym, profile.name);
            }
          }
        } catch {
          // Silently skip individual failures
        }
      }
    }
  }

  return result;
}
