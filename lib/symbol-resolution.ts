// ─── Merged Symbol-Resolution Module ────────────────────────────────
// Single authority for symbol validation AND company-name→ticker resolution.
// Consolidates 5 previously-independent paths:
//   1. lib/symbol-validator.ts         — cache + CRITICAL_ETFS fallback
//   2. lib/validate-markers.ts         — Finnhub profile post-validation
//   3. lib/tools/resolve-symbol.ts     — AI tool (company→ticker)
//   4. chat route preResolveTickers()  — pre-resolution batch
//   5. validate-recommendations CHECK 2 — cache check + live fallback
//
// Fallback chain (per lookup):
//   Tier 0: In-memory cache (24h TTL, loaded from Finnhub stock/symbol)
//   Tier 1: Live Finnhub /stock/profile2 lookup
//   Tier 2: Finnhub /search (company name → ticker)
//   Tier 3: Cache-fallback allowlist (CRITICAL_ETFS, low confidence, tagged)
//
// Every result carries source metadata so consumers can decide weighting.
// ──────────────────────────────────────────────────────────────────

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_HEALTH_THRESHOLD = 5000;       // minimum expected US symbols
const US_TICKER_RE = /^[A-Z]{1,5}(?:\.[A-Z])?$/;
const ALLOWED_TYPES = new Set(['common stock', 'adr', 'etf', 'reit']);

// ── Types ─────────────────────────────────────────────────

export type ResolutionSource =
  | 'cache'
  | 'finnhub_profile'
  | 'finnhub_search'
  | 'cache_fallback';

export type ResolutionConfidence = 'high' | 'medium' | 'low';

export interface ResolvedSymbol {
  symbol: string;
  name: string;
  source: ResolutionSource;
  confidence: ResolutionConfidence;
  exchange?: string;
}

export interface MarkerValidationResult {
  ok: boolean;
  correctedText?: string;
  /** Backward-compatible alias for correctedText (used by chat route). */
  corrected?: string;
  issues: Array<{
    symbol: string;
    raw: string;
    detail: string;
    correction?: string | string[];
  }>;
  hasCorrections: boolean;
}

// ── In-memory cache ──────────────────────────────────────

let _cache: Set<string> | null = null;
let _nameMap: Map<string, string> | null = null;
let _lastFetchTime = 0;

function getApiKey(): string | null {
  return process.env.FINNHUB_IO_API_KEY || process.env.FINNHUB_API_KEY || null;
}

// ── Cache-fallback allowlist (was CRITICAL_ETFS) ──────────

const FALLBACK_SYMBOLS: Record<string, string> = {
  'VOO': 'Vanguard S&P 500 ETF',
  'QQQ': 'Invesco QQQ Trust',
  'SPY': 'SPDR S&P 500 ETF Trust',
  'SCHD': 'Schwab U.S. Dividend Equity ETF',
  'VTI': 'Vanguard Total Stock Market ETF',
  'IVV': 'iShares Core S&P 500 ETF',
  'VEA': 'Vanguard FTSE Developed Markets ETF',
  'BND': 'Vanguard Total Bond Market ETF',
  'VGT': 'Vanguard Information Technology ETF',
  'XLK': 'Technology Select Sector SPDR Fund',
  'VTV': 'Vanguard Value ETF',
  'VUG': 'Vanguard Growth ETF',
  'XLV': 'Health Care Select Sector SPDR Fund',
  'XLF': 'Financial Select Sector SPDR Fund',
  'SMH': 'VanEck Semiconductor ETF',
  'VYM': 'Vanguard High Dividend Yield ETF',
  'JEPI': 'JPMorgan Equity Premium Income ETF',
  'PFF': 'iShares Preferred & Income Securities ETF',
  // Public companies Finnhub free tier might miss (verified via Yahoo Finance)
  'SPCX': 'Space Exploration Technologies Corp.',
};

// Tickers that Finnhub free tier may not index (newer IPOs, etc.)
// Phase -1: these bypass Finnhub entirely and resolve authoritatively.
const PREVERIFIED_TICKERS: Record<string, { name: string; exchange: string }> = {
  'SPCX': { name: 'Space Exploration Technologies Corp.', exchange: 'NasdaqGS' },
  'SPACEX': { name: 'Space Exploration Technologies Corp.', exchange: 'NasdaqGS' },
};

// ── Helpers ───────────────────────────────────────────────

function isUSLookup(r: any): boolean {
  const symbol = r.symbol || '';
  return US_TICKER_RE.test(symbol) && ALLOWED_TYPES.has((r.type || '').toLowerCase());
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(?:inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|se|nv|bv|co\.?|company|holdings?|group|international|technologies?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Word-overlap ratio between two normalized names (0–1). */
function nameOverlapRatio(name1: string, name2: string): number {
  const words1 = new Set(normalizeName(name1).split(' ').filter(w => w.length > 1));
  const words2 = new Set(normalizeName(name2).split(' ').filter(w => w.length > 1));
  if (words1.size === 0 || words2.size === 0) return 0;
  const overlap = [...words1].filter(w => words2.has(w)).length;
  return overlap / Math.min(words1.size, words2.size);
}

// ── Tier 0: Symbol Cache ──────────────────────────────────

/** Load the full US-symbol cache from Finnhub (24h TTL). */
async function loadSymbolCacheInternal(apiKey: string): Promise<{ symbols: Set<string>; nameMap: Map<string, string> }> {
  const now = Date.now();
  if (_cache && _nameMap && (now - _lastFetchTime) < CACHE_TTL_MS) {
    return { symbols: _cache, nameMap: _nameMap };
  }

  try {
    const [stockRes, etfRes] = await Promise.all([
      fetch(`${FINNHUB_BASE}/stock/symbol?exchange=US&token=${apiKey}`, { signal: AbortSignal.timeout(15000) }),
      fetch(`${FINNHUB_BASE}/etf/list?exchange=US&token=${apiKey}`, { signal: AbortSignal.timeout(15000) }),
    ]);

    const symbols = new Set<string>();
    const nameMap = new Map<string, string>();

    if (stockRes.ok) {
      const stockData = await stockRes.json();
      for (const entry of stockData || []) {
        if (entry.symbol && US_TICKER_RE.test(entry.symbol)) {
          symbols.add(entry.symbol.toUpperCase());
          if (entry.description) nameMap.set(entry.symbol.toUpperCase(), entry.description);
        }
      }
    }

    if (etfRes.ok) {
      const etfData = await etfRes.json();
      for (const entry of etfData || []) {
        if (entry.symbol && US_TICKER_RE.test(entry.symbol)) {
          symbols.add(entry.symbol.toUpperCase());
          if (entry.description) nameMap.set(entry.symbol.toUpperCase(), entry.description);
        }
      }
    }

    // Inject fallback symbols that Finnhub missed
    let fallbackCount = 0;
    for (const [etf, name] of Object.entries(FALLBACK_SYMBOLS)) {
      if (!symbols.has(etf)) {
        symbols.add(etf);
        nameMap.set(etf, name);
        fallbackCount++;
      }
    }

    _cache = symbols;
    _nameMap = nameMap;
    _lastFetchTime = now;

    console.log(`[symbol-resolution] Cache loaded: ${symbols.size.toLocaleString()} symbols, ${nameMap.size.toLocaleString()} names`);
    if (fallbackCount > 0) {
      console.warn(`[symbol-resolution] ⚠️ ${fallbackCount}/${Object.keys(FALLBACK_SYMBOLS).length} fallback ETFs injected (missing from Finnhub)`);
    }
    if (symbols.size < CACHE_HEALTH_THRESHOLD) {
      console.error(`[symbol-resolution] ⚠️ HEALTH WARNING: cache below threshold (${symbols.size.toLocaleString()} < ${CACHE_HEALTH_THRESHOLD.toLocaleString()})`);
    } else {
      console.log(`[symbol-resolution] ✅ Cache health OK (${symbols.size.toLocaleString()} ≥ ${CACHE_HEALTH_THRESHOLD.toLocaleString()})`);
    }

    return { symbols, nameMap };
  } catch (err: any) {
    console.error(`[symbol-resolution] Cache load failed: ${err.message}`);
    if (_cache && _nameMap) return { symbols: _cache, nameMap: _nameMap }; // stale is better than nothing
    return { symbols: new Set(), nameMap: new Map() };
  }
}

// ── Tier 1: Live Finnhub profile2 ─────────────────────────

async function lookupFinnhubProfile(symbol: string, apiKey: string): Promise<ResolvedSymbol | null> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const p = await res.json();
    if (!p.name || !p.ticker) return null;
    if (!US_TICKER_RE.test(p.ticker)) return null;

    // Exchange guard: reject delisted/bankrupt stocks
    const exchange = (p.exchange || '').trim();
    if (!exchange) return null;

    // Bankruptcy suffix guard: 5-char tickers ending in Q
    if (p.ticker.length === 5 && p.ticker.endsWith('Q')) return null;

    return {
      symbol: p.ticker.toUpperCase(),
      name: p.name,
      source: 'finnhub_profile',
      confidence: 'high',
      exchange: exchange || undefined,
    };
  } catch {
    return null;
  }
}

// ── Tier 2: Finnhub company search ────────────────────────

interface FinnhubSearchResult {
  symbol: string;
  description: string;
  type: string;
  exchange?: string;
  displaySymbol?: string;
}

async function searchFinnhubCompany(query: string, apiKey: string): Promise<FinnhubSearchResult[]> {
  try {
    const res = await fetch(
      `${FINNHUB_BASE}/search?q=${encodeURIComponent(query)}&token=${apiKey}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const data = await res.json();
    const raw = (data.result || []);
    const filtered = raw.filter(isUSLookup);
    if (raw.length > 0 && filtered.length === 0) {
      console.warn(`[symbol-res] 🔍 Finnhub search for "${query}": ${raw.length} raw results but 0 passed isUSLookup. Raw types: ${raw.slice(0,5).map((r:any) => `${r.symbol}(${r.type})`).join(', ')}`);
    }
    return filtered;
  } catch {
    return [];
  }
}

// ── Tier 2b: Ticker generation for OTC ADRs ───────────────

/** Generate plausible US ticker patterns from a company name.
 *  Catches OTC ADRs that Finnhub search misses (e.g., SKHYV for "SK Hynix"). */
function generateTickerPatterns(name: string): string[] {
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

  for (const w of clean) add(w);

  // First word + first chars of last word
  for (let i = 1; i <= Math.min(4, last.length); i++) add(first + last.slice(0, i));

  // First N chars of combined name
  const combined = clean.join('');
  for (let i = 2; i <= Math.min(5, combined.length); i++) add(combined.slice(0, i));

  // Acronym
  const acronym = clean.map(w => w[0]).join('');
  for (let i = 2; i <= Math.min(5, acronym.length); i++) add(acronym.slice(0, i));

  // Extended acronym
  if (clean.length >= 2 && acronym.length >= 2) {
    for (const trail of ['M', 'C', 'I', 'N', 'S', 'A']) {
      const ext = acronym + trail;
      if (ext.length <= 5) add(ext);
    }
  }

  // ADR suffixes
  const all = [...set];
  for (const base of all) {
    add(base + 'V');
    add(base + 'Y');
    add(base + 'F');
  }

  // Prioritize: composite ADR first, then composite/acro, then other ADR, then rest
  const compositeSet = new Set<string>();
  for (let i = 1; i <= Math.min(4, last.length); i++) {
    compositeSet.add(first + last.slice(0, i));
  }
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

  return [...set].sort((a, b) => {
    const score = (s: string) => {
      if (compositeAdrSet.has(s)) return 3;
      if (compositeSet.has(s) || acroSet.has(s)) return 2;
      if (s.length >= 3 && /[VYF]$/.test(s)) return 1;
      return 0;
    };
    return score(b) - score(a);
  });
}

// ── Primary API: validate ticker ───────────────────────────

/**
 * Validate a ticker symbol against the resolution chain.
 * Returns a ResolvedSymbol with source metadata, or null if unresolvable.
 *
 * Fallback chain:
 *   1. In-memory cache (24h TTL)        → confidence: high
 *   2. Live Finnhub profile2 lookup     → confidence: high
 *   3. Cache-fallback (CRITICAL_ETFS)   → confidence: low, source tagged
 */
export async function validateSymbol(symbol: string): Promise<ResolvedSymbol | null> {
  const clean = symbol.toUpperCase().trim();
  if (!US_TICKER_RE.test(clean)) return null;

  const key = getApiKey();

  // Tier 0: Cache
  if (key) {
    const { symbols, nameMap } = await loadSymbolCacheInternal(key);
    if (symbols.has(clean)) {
      const name = nameMap.get(clean);

      // Check if this was a fallback entry
      if (FALLBACK_SYMBOLS[clean] && !key) {
        return {
          symbol: clean,
          name: name || FALLBACK_SYMBOLS[clean],
          source: 'cache_fallback',
          confidence: 'low',
        };
      }

      return {
        symbol: clean,
        name: name || clean,
        source: 'cache',
        confidence: FALLBACK_SYMBOLS[clean] ? 'medium' : 'high',
      };
    }
  }

  // Tier 1: Live profile lookup
  if (key) {
    const profile = await lookupFinnhubProfile(clean, key);
    if (profile) return profile;
  }

  // Tier 2: Cache-fallback (last resort)
  if (FALLBACK_SYMBOLS[clean]) {
    return {
      symbol: clean,
      name: FALLBACK_SYMBOLS[clean],
      source: 'cache_fallback',
      confidence: 'low',
    };
  }

  return null;
}

// ── Primary API: resolve company name → ticker(s) ──────────

/**
 * Resolve a company name to US-traded ticker symbol(s).
 * Used by the resolveSymbol AI tool AND pre-resolution batch.
 *
 * Returns all viable candidates sorted by confidence.
 */
export async function resolveCompanyName(
  companyName: string,
  opts?: { maxCandidates?: number },
): Promise<ResolvedSymbol[]> {
  const key = getApiKey();
  if (!key) {
    // Without API key, check cache for partial name matches
    const results: ResolvedSymbol[] = [];
    for (const [sym, name] of Object.entries(FALLBACK_SYMBOLS)) {
      if (nameOverlapRatio(name, companyName) > 0.3) {
        results.push({ symbol: sym, name, source: 'cache_fallback', confidence: 'low' });
      }
    }
    return results;
  }

  const max = opts?.maxCandidates ?? 5;

  // Phase -1: Pre-verified tickers — bypass Finnhub entirely for stocks
  // we know exist but Finnhub's free tier might not index (e.g., newer IPOs).
  const upperQuery = companyName.trim().toUpperCase();
  if (PREVERIFIED_TICKERS[upperQuery]) {
    const pv = PREVERIFIED_TICKERS[upperQuery];
    console.log(`[symbol-res] ✅ Phase -1: Pre-verified ticker "${upperQuery}" → ${pv.name} (${pv.exchange})`);
    return [{
      symbol: upperQuery,
      name: pv.name,
      source: 'cache_fallback',
      confidence: 'high',
      exchange: pv.exchange,
    }];
  }

  // Phase 0: Direct ticker lookup — if input looks like a US ticker symbol,
  // check Finnhub profile directly before trying name-based search.
  // Catches tickers that Finnhub's search index might miss (newer IPOs, etc.)
  if (/^[A-Z]{1,5}$/i.test(companyName.trim())) {
    const ticker = companyName.trim().toUpperCase();
    const profile = await lookupFinnhubProfile(ticker, key);
    if (profile) {
      console.log(`[symbol-res] ✅ Phase 0: Direct ticker lookup "${ticker}" → ${profile.name} (${profile.exchange})`);
      return [profile];
    }
    // Ticker not found via profile — still try name search as fallback
    console.log(`[symbol-res] 🔍 Phase 0: "${ticker}" no profile match — falling back to name search`);
  }

  // Phase 1: Direct Finnhub company-name search
  let searchResults = await searchFinnhubCompany(companyName, key);

  // Phase 2: Ticker-generation fallback (for OTC ADRs)
  if (searchResults.length === 0) {
    const patterns = generateTickerPatterns(companyName).slice(0, 15);
    if (patterns.length > 0) {
      const seen = new Set<string>();
      const enriched: FinnhubSearchResult[] = [];
      for (let i = 0; i < patterns.length && enriched.length < max; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, 300));
        const batch = await searchFinnhubCompany(patterns[i], key);
        for (const r of batch) {
          if (!seen.has(r.symbol) && nameOverlapRatio(r.description, companyName) > 0.3) {
            seen.add(r.symbol);
            enriched.push(r);
          }
        }
      }
      searchResults = enriched;
    }
  }

  if (searchResults.length === 0) return [];

  // Phase 3: Enrich with profile data
  const enriched = await Promise.all(
    searchResults.slice(0, max).map(async (r): Promise<ResolvedSymbol | null> => {
      const profile = await lookupFinnhubProfile(r.symbol, key);
      if (profile) return profile;
      // Fallback: use search data
      if (r.symbol.length === 5 && r.symbol.endsWith('Q')) return null; // bankruptcy guard
      return {
        symbol: r.symbol.toUpperCase(),
        name: r.description || r.symbol,
        source: 'finnhub_search',
        confidence: 'medium',
        exchange: r.exchange,
      };
    }),
  );

  return enriched.filter((c): c is ResolvedSymbol => c !== null);
}

// ── API: validate multiple markers at once ─────────────────

/**
 * Validate a batch of [RECOMMEND:SYMBOL:BUY/SELL:$N] markers.
 * Handles: unknown symbols, foreign-exchange suffixes, duplicate companies.
 * Returns corrected text and issue list.
 */
export async function validateRecommendationMarkers(
  responseText: string,
  markerRegex: RegExp = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):(BUY|SELL):\$?([\d,]+(?:\.[\d,]+)?)\]/g,
): Promise<MarkerValidationResult> {
  const issues: MarkerValidationResult['issues'] = [];
  let correctedText = responseText;
  let hasCorrections = false;

  const markers = [...responseText.matchAll(markerRegex)].map(m => ({
    raw: m[0],
    symbol: m[1].toUpperCase(),
    side: m[2],
    amount: m[3],
  }));

  if (markers.length === 0) {
    return { ok: true, issues: [], hasCorrections: false };
  }

  for (const m of markers) {
    // Check for foreign exchange suffixes
    const dotIdx = m.symbol.lastIndexOf('.');
    if (dotIdx >= 0) {
      const suffix = m.symbol.slice(dotIdx + 1).toUpperCase();
      const EXCHANGE_SUFFIXES = new Set([
        'DE', 'MX', 'SW', 'L', 'PA', 'BR', 'AR', 'TO', 'V', 'CN', 'TW', 'HK',
        'KS', 'T', 'HE', 'CO', 'ST', 'OL', 'MC', 'MI', 'AS', 'LS', 'SG', 'SI',
        'SA', 'F', 'WA', 'B', 'JK', 'IL', 'TA', 'IR', 'NS', 'VI', 'SS', 'BO',
        'BA', 'SN', 'DU', 'HM',
      ]);
      if (EXCHANGE_SUFFIXES.has(suffix)) {
        const base = m.symbol.slice(0, dotIdx);
        const resolved = await validateSymbol(base);
        if (resolved) {
          issues.push({
            symbol: m.symbol,
            raw: m.raw,
            detail: `Foreign exchange suffix (.${suffix}). Use US primary "${base}" instead.`,
            correction: base,
          });
          correctedText = correctedText.replace(
            m.raw,
            m.raw.replace(m.symbol, base),
          );
          hasCorrections = true;
          continue;
        }
      }
    }

    // Validate ticker
    const resolved = await validateSymbol(m.symbol);
    if (!resolved) {
      issues.push({
        symbol: m.symbol,
        raw: m.raw,
        detail: `"${m.symbol}" is not a recognized US-traded symbol.`,
      });
    }
    // Check if this is a low-confidence fallback
    if (resolved && resolved.confidence === 'low') {
      console.warn(`[symbol-resolution] ⚠️ Marker "${m.symbol}" resolved via cache fallback (low confidence)`);
    }
  }

  // Also check: context-based company-name mismatch (Finnhub profile check)
  // Extract company names from text surrounding each marker
  const key = getApiKey();
  if (key) {
    for (const m of markers) {
      const contextName = extractContextName(responseText, m.symbol);
      if (!contextName) continue;

      const profile = await lookupFinnhubProfile(m.symbol, key);
      if (!profile) continue;

      const overlap = nameOverlapRatio(profile.name, contextName);
      if (overlap <= 0.5) {
        // Possible mismatch — try to find the correct ticker
        const candidates = await resolveCompanyName(contextName, { maxCandidates: 3 });
        const correction = candidates.length > 0
          ? candidates.map(c => c.symbol)
          : null;

        issues.push({
          symbol: m.symbol,
          raw: m.raw,
          detail: `"${m.symbol}" maps to "${profile.name}" but context mentions "${contextName}". Possible ticker mismatch.`,
          correction: correction || undefined,
        });

        if (correction && correction.length === 1) {
          correctedText = correctedText.replace(m.raw, m.raw.replace(m.symbol, correction[0]));
          hasCorrections = true;
        }
      }
    }
  }

  return {
    ok: issues.length === 0,
    correctedText: hasCorrections ? correctedText : undefined,
    corrected: hasCorrections ? correctedText : undefined,
    issues,
    hasCorrections,
  };
}

// ── API: batch pre-resolution (for chat preResolveTickers) ──

/**
 * Batch-resolve company names to ticker symbols before an AI call.
 * Returns only high/medium-confidence single matches.
 */
export async function batchResolveCompanyNames(
  names: string[],
): Promise<Array<{ name: string; symbol: string }>> {
  const resolved: Array<{ name: string; symbol: string }> = [];

  for (let i = 0; i < names.length; i += 5) {
    const batch = names.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (name) => {
        const candidates = await resolveCompanyName(name, { maxCandidates: 3 });
        // Only return single, high-confidence matches
        if (candidates.length === 1 && candidates[0].confidence !== 'low') {
          return { name, symbol: candidates[0].symbol };
        }
        return null;
      }),
    );
    for (const r of results) {
      if (r) resolved.push(r);
    }
    if (i + 5 < names.length) await new Promise(r => setTimeout(r, 200));
  }

  return resolved;
}

// ── API: lookup names for symbols ─────────────────────────

/**
 * Get display names for a list of ticker symbols.
 */
export async function lookupSymbolNames(
  symbols: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const key = getApiKey();

  if (key) {
    const { nameMap } = await loadSymbolCacheInternal(key);
    for (const sym of symbols) {
      const name = nameMap.get(sym.toUpperCase());
      if (name) result.set(sym.toUpperCase(), name);
    }
  }

  // Fill gaps from fallback
  for (const sym of symbols) {
    const upper = sym.toUpperCase();
    if (!result.has(upper) && FALLBACK_SYMBOLS[upper]) {
      result.set(upper, FALLBACK_SYMBOLS[upper]);
    }
  }

  return result;
}

// ── API: get cached symbol set (for bulk validation) ──────

/**
 * Get the full set of cached US symbols.
 * Returns empty set if cache is unavailable (callers should treat as "skip validation").
 */
export async function getCachedSymbolSet(): Promise<Set<string>> {
  const key = getApiKey();
  if (!key) return new Set();
  const { symbols } = await loadSymbolCacheInternal(key);
  return symbols;
}

// ── Helper: extract company name from text near a ticker ───

function extractContextName(text: string, symbol: string): string | null {
  const markerPattern = new RegExp(
    `\\[RECOMMEND:${symbol.replace(/\./g, '\\.')}:(BUY|SELL)(?::(?:\\$?\\d+(?:\\.\\d+)?))?\\]`,
    'g',
  );
  if (!markerPattern.test(text)) return null;

  // Get the text BEFORE the marker
  const markerIdx = text.indexOf(`[RECOMMEND:${symbol}`);
  if (markerIdx < 0) return null;
  const beforeText = text.slice(Math.max(0, markerIdx - 200), markerIdx);

  // Look for company-name patterns: "SK Hynix", "Nvidia (NVDA)", "$TICKER (NAME)"
  const nameCandidates: string[] = [];

  // Pattern: Word Word — two title-case words that look like a company name
  const words = beforeText.replace(/[\[\](){}*_~`]/g, ' ').trim().split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i];
    const w2 = words[i + 1];
    if (
      /^[A-Z][a-zÀ-ÿ]{2,}$/.test(w1) &&
      /^[A-Z][a-zÀ-ÿ]{2,}$/.test(w2) &&
      !['BUY', 'SELL', 'The', 'This', 'That', 'Your', 'Here', 'What', 'When', 'How', 'ETF'].includes(w1)
    ) {
      nameCandidates.push(`${w1} ${w2}`);
    }
  }

  // Pattern: single title-case word (Nvidia, Apple)
  for (const w of words) {
    if (
      /^[A-Z][a-zÀ-ÿ]{3,}$/.test(w) &&
      !['Buy', 'Sell', 'This', 'That', 'Your', 'Here', 'What', 'When', 'How'].includes(w) &&
      w.length >= 5
    ) {
      nameCandidates.push(w);
    }
  }

  // Return the last (closest to marker) candidate
  return nameCandidates.length > 0 ? nameCandidates[nameCandidates.length - 1] : null;
}

// ── Public API: backward-compatible with symbol-validator.ts ──

/**
 * Load the US-symbol cache (public wrapper).
 * Returns the Set of valid US symbols — an empty set means "skip validation".
 * Equivalent to symbol-validator.ts loadSymbolCache.
 */
export async function loadSymbolCache(): Promise<Set<string>> {
  const key = getApiKey();
  if (!key) return new Set();
  const { symbols } = await loadSymbolCacheInternal(key);
  return symbols;
}

/**
 * Get the full symbol cache with name mappings (for client-side one-time loading).
 * Equivalent to symbol-validator.ts getCachedSymbols.
 */
export async function getCachedSymbols(): Promise<{
  symbols: string[];
  symbolNames: Map<string, string>;
}> {
  const key = getApiKey();
  if (!key) return { symbols: [], symbolNames: new Map() };
  const { symbols, nameMap } = await loadSymbolCacheInternal(key);
  return { symbols: Array.from(symbols).sort(), symbolNames: nameMap };
}

/**
 * Search the cached symbol list by company name / description substring.
 * Falls back when Finnhub /search returns empty (e.g. "SK Hynix" → SKHYV).
 * Equivalent to symbol-validator.ts searchSymbolsByName.
 */
export async function searchSymbolsByName(
  query: string,
  limit: number = 10,
): Promise<Array<{ symbol: string; name: string; score: number }>> {
  const key = getApiKey();
  if (key) await loadSymbolCacheInternal(key); // warm cache
  if (!_nameMap || _nameMap.size === 0) return [];

  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(w => w.length >= 2);
  if (words.length === 0) return [];

  const results: Array<{ symbol: string; name: string; score: number }> = [];

  for (const [symbol, name] of _nameMap) {
    const nameLower = name.toLowerCase();
    let score = 0;

    if (nameLower === q) {
      score = 100;
    } else if (nameLower.startsWith(q)) {
      score = 80;
    } else if (nameLower.includes(q)) {
      score = 60;
    } else {
      let matchedWords = 0;
      for (const word of words) {
        if (nameLower.includes(word)) matchedWords++;
      }
      if (matchedWords === 0) continue;
      score = matchedWords * 15;
    }

    if (symbol.toLowerCase().startsWith(q)) {
      score += 10;
    }

    results.push({ symbol, name, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ── Re-export FALLBACK_SYMBOLS for consumers that need the list ──

export { FALLBACK_SYMBOLS };

// ═══════════════════════════════════════════════════════════════
// Shared symbol filters — single authority for the entire codebase.
// Previously duplicated across chat route, validate-markers, and
// symbol-resolution itself. Now exported from here only.
// ═══════════════════════════════════════════════════════════════

/** Common words/abbreviations that match ticker regex but aren't stocks. */
export const NOT_TICKERS = new Set([
  'IPO', 'ETF', 'REIT', 'CEO', 'CFO', 'GDP', 'API', 'AI', 'ML', 'ITM', 'OTM',
  'THE', 'AND', 'FOR', 'NOT', 'BUT', 'WAS', 'HAS', 'CAN', 'ARE', 'YOU', 'OUR',
  'HOW', 'WHAT', 'WHEN', 'WHY', 'WHO', 'NEW', 'OUT', 'ALL', 'ANY', 'ONE', 'TWO',
  'ITS', 'HIS', 'HER', 'THEM', 'THEY', 'FROM', 'THAT', 'THIS', 'WITH', 'WILL',
  'JUST', 'NOW', 'VERY', 'MUCH', 'WELL', 'ALSO', 'THEN', 'SOME', 'LIKE', 'GET',
  'SEE', 'GOOD', 'BAD', 'BIG', 'PUT', 'CALL', 'IN', 'ON', 'IT', 'AT', 'TO',
  'BE', 'IS', 'SO', 'ME', 'MY', 'WE', 'HE', 'NO', 'GO', 'DO', 'UP', 'AM',
  'A', 'I', 'O', 'USD', 'EST', 'LTD', 'INC', 'CORP', 'PLC', 'LLC', 'NYSE',
  'NASDAQ', 'SVS', 'USA', 'EUR', 'GBP', 'JPY', 'YTD', 'NYSEARCA',
  'BUY', 'SELL', 'HOLD', 'PUT', 'CALL',
  // Common words that match {2,5} uppercase pattern (false positives with /i regex)
  'STOCK', 'STOCKS', 'WORTH', 'ABOUT', 'THINK', 'SHARE', 'SHARES', 'QUOTE',
  'PRICE', 'MAYBE', 'SHOULD', 'COULD', 'WOULD', 'WANT', 'NEED',
  'HERE', 'THERE', 'WHICH', 'RIGHT', 'STILL', 'OTHER', 'AFTER', 'FIRST',
  'WHERE', 'EVERY', 'DON', 'DOES', 'MORE', 'LESS', 'ONLY', 'MOST', 'LAST',
  'ADD', 'SHOW', 'OF', 'VS', 'CHART', 'MAKE', 'TAKE', 'GIVE', 'FIND', 'HIGH',
  // Exchange/country-code suffixes — prevent ghost buttons from foreign listings
  'DE', 'MX', 'SW', 'VI', 'SN', 'DU', 'HM', 'GLP', 'LN', 'L', 'PA', 'SA',
  'TO', 'CN', 'HK', 'JP', 'KR', 'BR', 'IN', 'AU', 'AS', 'AX', 'TA', 'OL',
]);

/** Known foreign exchange suffixes the AI hallucinates despite prompt forbidding. */
export const FOREIGN_EXCHANGE_SUFFIXES = new Set([
  'DE', 'DU', 'F', 'HM', 'GLP',   // German exchanges (XETRA, Frankfurt, Hamburg, etc.)
  'MX',                           // Mexico
  'SW', 'VI',                     // Swiss, Vienna
  'SN',                           // Santiago
  'AX',                           // Australia
  'LN', 'L', 'IL',                // London, London Intl
  'PA',                           // Paris
  'SA',                           // Saudi / Sao Paulo
  'AS', 'BR',                     // Amsterdam, Brussels
  'CN', 'HK', 'KS', 'KQ', 'T',   // Canada, Hong Kong, Korea, Tokyo
  'MC', 'MI',                     // Madrid, Milan
  'MU', 'NE',                     // Munich, New Zealand?
  'NX', 'OL', 'RG', 'SG',        // Various exchange suffixes
  'SS', 'ST',                     // Stockholm, Singapore derivatives?
  'TO', 'V', 'VN',                // Toronto, Vienna alt, Vietnam
]);

/** Words commonly appearing in financial text that aren't company names. */
export const NOT_COMPANIES = new Set([
  'NYSE', 'NASDAQ', 'STOCK', 'STOCKS', 'SHARE', 'SHARES', 'PRICE', 'PRICES',
  'TRADE', 'TRADING', 'MARKET', 'MARKETS', 'INVEST', 'INVESTING', 'ANALYST',
  'FUTURE', 'FUTURES', 'TODAY', 'QUARTERLY', 'ANNUAL', 'REPORT', 'REPORTS',
  'GROWTH', 'VALUE', 'PROFIT', 'REVENUE', 'EARNINGS', 'DIVIDEND', 'YIELD',
  'TECH', 'HEALTH', 'FINANCE', 'ENERGY', 'SECTOR', 'SECTORS', 'INDUSTRY',
  'YAHOO', 'BLOOMBERG', 'REUTERS', 'BARRONS', 'FIDELITY', 'VANGUARD',
  'RECOMMEND', 'RECOMMENDATION', 'ANALYSIS', 'OUTLOOK', 'FORECAST',
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY',
  'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
  'PORTFOLIO', 'ALLOCATION', 'BUDGET', 'STRATEGY', 'RISK', 'BALANCE',
  'COMPANY', 'CORPORATION', 'HOLDINGS', 'LIMITED', 'GROUP', 'LTD', 'CORP', 'INC',
  'INTERNATIONAL', 'RESEARCH', 'MANAGEMENT', 'CAPITAL', 'PARTNERS',
]);

/** Common proper nouns / question words that aren't company names. */
export const FILTERED_COMMON_WORDS = /^(This|That|What|When|Where|Why|Which|Whose|How|There|Today|Tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Could|Would|Should|About|Your|Their|Some|Many|More|Less|Each|Every|Other|After|Before|During|Still|Already|Always|Never|Tell|Show|Find|Look|Check|Search|Give|Make|Take|Know|Think|Want|Need|Like|Love|Can|Will|Just|Also|Only|Even|Then|Than|Its|His|Her|Our|Been|Being|Having|Doing|Going|Getting)$/;

/** Check if a word is a filtered common word (not a company name). */
export function isFilteredCommonWord(word: string): boolean {
  return FILTERED_COMMON_WORDS.test(word);
}
