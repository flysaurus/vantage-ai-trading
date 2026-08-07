// ─── Symbol Resolver ─────────────────────────────────────────
// Phase 2: Broker-agnostic symbol normalization and resolution.
//
// Every broker may return or expect symbols in slightly different
// formats (exchange suffixes, country codes, lowercase, etc.).
// This module ensures all symbol cross-references are normalized
// to a standard uppercase ticker, and provides forward/reverse
// resolution for broker-specific formats.
//
// USAGE:
//   import { normalizeSymbol, toBrokerSymbol, toStandardSymbol } from './symbol-resolver';
//
//   const ticker = normalizeSymbol("aapl");           // → "AAPL"
//   const brokerSym = toBrokerSymbol("AAPL", "alpaca");  // → "AAPL"
//   const std = toStandardSymbol("AAPL:US", "snaptrade"); // → "AAPL"

// ─── Normalization ────────────────────────────────────────

/**
 * Normalize a raw symbol to our canonical format: uppercase ticker.
 * Strips whitespace and converts to uppercase.
 * Does NOT strip exchange/country suffixes — call toStandardSymbol() for that.
 */
export function normalizeSymbol(symbol: string): string {
  return String(symbol ?? '').trim().toUpperCase();
}

/**
 * Map of known exchange suffixes to strip.
 * e.g. "AAPL.NASDAQ" → "AAPL", "VOO.ARCA" → "VOO"
 */
const EXCHANGE_SUFFIX_RE = /\.(NYSE|NASDAQ|AMEX|ARCA|BATS|IEX|MEMX|MIAX)$/;

/**
 * Map of known country-code suffixes to strip.
 * e.g. "AAPL:US" → "AAPL", "SHOP:CA" → "SHOP"
 */
const COUNTRY_SUFFIX_RE = /:(US|CA|UK|DE|FR|JP|HK|AU)$/;

/**
 * Convert a broker-specific symbol to our standard format.
 *
 * Handles:
 *   - Exchange suffixes: "AAPL.NASDAQ" → "AAPL"
 *   - Country codes:     "SHOP:CA"      → "SHOP"
 *   - Lowercase:         "aapl"         → "AAPL"
 *   - Whitespace:        " AAPL "       → "AAPL"
 *
 * This is the function to call when ingesting symbols from ANY broker.
 */
export function toStandardSymbol(brokerSymbol: string, _brokerSlug?: string): string {
  let sym = normalizeSymbol(brokerSymbol);

  // Strip suffixes iteratively (they may appear in any order: .NASDAQ:US or :US.NASDAQ)
  // Most common real-world format is just one suffix, but handle both defensively.
  let changed = true;
  while (changed) {
    changed = false;
    const before = sym;
    sym = sym.replace(EXCHANGE_SUFFIX_RE, '').replace(COUNTRY_SUFFIX_RE, '');
    if (sym !== before) changed = true;
  }

  return sym;
}

/**
 * Convert our standard ticker to the format a specific broker expects
 * when placing orders or querying that broker's API.
 *
 * Most US brokers accept standard uppercase tickers directly.
 * Edge cases are handled per-broker below.
 */
export function toBrokerSymbol(standardTicker: string, brokerSlug: string): string {
  const sym = normalizeSymbol(standardTicker);

  switch (brokerSlug) {
    case 'alpaca':
      // Alpaca uses standard tickers natively
      return sym;

    case 'snaptrade':
      // SnapTrade passes through to the underlying brokerage.
      // Most US brokerages accept standard tickers.
      // For international brokers, the symbol may need country suffix.
      // For now: standard ticker — will extend if needed.
      return sym;

    case 'ibkr':
      // Interactive Brokers may use exchange suffix on some symbols
      // For now: standard ticker
      return sym;

    case 'demo':
      return sym;

    default:
      // Unknown brokers: assume standard ticker format
      return sym;
  }
}

// ─── Batch Operations ─────────────────────────────────────

/**
 * Normalize an array of symbols — useful for batch position lookups.
 */
export function toStandardSymbols(
  symbols: string[],
  brokerSlug?: string,
): string[] {
  return symbols.map((s) => toStandardSymbol(s, brokerSlug));
}

/**
 * Resolve an array of standard tickers to broker-specific format.
 */
export function toBrokerSymbols(
  standardTickers: string[],
  brokerSlug: string,
): string[] {
  return standardTickers.map((t) => toBrokerSymbol(t, brokerSlug));
}

// ─── Symbol-Keyed Lookup ───────────────────────────────────

/**
 * Build a normalized-symbol-keyed lookup map from a broker-keyed map.
 * Useful for matching broker positions to screener results.
 *
 * @example
 *   const positions = { "AAPL.NASDAQ": { qty: 10 }, "BRK.B": { qty: 5 } };
 *   const lookup = buildSymbolLookup(positions, "snaptrade");
 *   lookup.get("AAPL") → { qty: 10 }
 *   lookup.get("BRK.B") → { qty: 5 }
 */
export function buildSymbolLookup<T>(
  items: Record<string, T>,
  brokerSlug?: string,
): Map<string, T> {
  const map = new Map<string, T>();
  for (const [rawSymbol, value] of Object.entries(items)) {
    const key = toStandardSymbol(rawSymbol, brokerSlug);
    map.set(key, value);
  }
  return map;
}
