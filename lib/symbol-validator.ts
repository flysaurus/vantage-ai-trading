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
    _lastFetchTime = now;
    console.log(`[symbol-validator] Cached ${symbols.size.toLocaleString()} valid US symbols (24h TTL)`);
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

/** Get the full symbol set (for client-side one-time loading). */
export async function getCachedSymbols(): Promise<string[]> {
  const cache = await loadSymbolCache();
  return Array.from(cache).sort();
}

/** Force refresh the symbol cache (e.g., from a cron job). */
export async function refreshSymbolCache(): Promise<Set<string>> {
  _lastFetchTime = 0; // Force re-fetch
  return loadSymbolCache();
}
