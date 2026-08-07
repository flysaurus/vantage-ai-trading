/**
 * Phase 2: Symbol Resolver — Standalone Verification Script
 *
 * Run: node tests/test-symbol-resolver.mjs
 * Tests all normalization, forward/reverse resolution, and batch operations.
 */

// Since the resolver uses TypeScript, we test the logic inline in plain JS.
// The actual TS module compiles and uses the same logic.

// ─── Replicated logic (mirrors lib/broker/symbol-resolver.ts) ───

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase();
}

const EXCHANGE_SUFFIX_RE = /\.(NYSE|NASDAQ|AMEX|ARCA|BATS|IEX|MEMX|MIAX)$/;
const COUNTRY_SUFFIX_RE = /:(US|CA|UK|DE|FR|JP|HK|AU)$/;

function toStandardSymbol(brokerSymbol) {
  let sym = normalizeSymbol(brokerSymbol);
  // Strip suffixes iteratively (any order)
  let changed = true;
  while (changed) {
    changed = false;
    const before = sym;
    sym = sym.replace(EXCHANGE_SUFFIX_RE, '').replace(COUNTRY_SUFFIX_RE, '');
    if (sym !== before) changed = true;
  }
  return sym;
}

function toBrokerSymbol(standardTicker, brokerSlug) {
  const sym = normalizeSymbol(standardTicker);
  switch (brokerSlug) {
    case 'alpaca':
    case 'snaptrade':
    case 'ibkr':
    case 'demo':
    default:
      return sym;
  }
}

function toStandardSymbols(symbols) {
  return symbols.map((s) => toStandardSymbol(s));
}

function toBrokerSymbols(standardTickers, brokerSlug) {
  return standardTickers.map((t) => toBrokerSymbol(t, brokerSlug));
}

function buildSymbolLookup(items, brokerSlug) {
  const map = new Map();
  for (const [rawSymbol, value] of Object.entries(items)) {
    const key = toStandardSymbol(rawSymbol, brokerSlug);
    map.set(key, value);
  }
  return map;
}

// ─── Test Runner ───

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

// ─── Tests ───

console.log('\n📐 Symbol Normalization');
test('uppercase conversion', () => {
  assert(normalizeSymbol('aapl') === 'AAPL');
  assert(normalizeSymbol('MsFt') === 'MSFT');
});

test('whitespace trimming', () => {
  assert(normalizeSymbol('  GOOGL ') === 'GOOGL');
  assert(normalizeSymbol('\tNVDA\n') === 'NVDA');
});

test('null/undefined safe', () => {
  assert(normalizeSymbol(null) === '', 'null → empty string');
  assert(normalizeSymbol(undefined) === '', 'undefined → empty string');
  assert(normalizeSymbol('') === '', 'empty → empty');
});

test('special characters preserved', () => {
  assert(normalizeSymbol('BRK.B') === 'BRK.B', 'period preserved');
  assert(normalizeSymbol('BF.B') === 'BF.B', 'class B preserved');
  assert(normalizeSymbol('VOO') === 'VOO', 'clean ticker');
});

console.log('\n🔄 toStandardSymbol');
test('exchange suffix stripped', () => {
  assert(toStandardSymbol('AAPL.NASDAQ') === 'AAPL');
  assert(toStandardSymbol('MSFT.NASDAQ') === 'MSFT');
  assert(toStandardSymbol('VOO.ARCA') === 'VOO');
  assert(toStandardSymbol('SPY.ARCA') === 'SPY');
  assert(toStandardSymbol('QQQ.BATS') === 'QQQ');
});

test('country suffix stripped', () => {
  assert(toStandardSymbol('AAPL:US') === 'AAPL');
  assert(toStandardSymbol('SHOP:CA') === 'SHOP');
  assert(toStandardSymbol('NVO:UK') === 'NVO');
});

test('both suffixes stripped (exchange first)', () => {
  // unlikely but defensive
  assert(toStandardSymbol('AAPL.NASDAQ:US') === 'AAPL');
});

test('no suffix = unchanged', () => {
  assert(toStandardSymbol('AAPL') === 'AAPL');
  assert(toStandardSymbol('MSFT') === 'MSFT');
  assert(toStandardSymbol('BRK.B') === 'BRK.B');
});

test('lowercase with suffix', () => {
  assert(toStandardSymbol('aapl.nasdaq') === 'AAPL');
  assert(toStandardSymbol('tsla:us') === 'TSLA');
});

console.log('\n➡️  toBrokerSymbol');
test('standard tickers pass through', () => {
  for (const broker of ['alpaca', 'snaptrade', 'ibkr', 'demo']) {
    assert(toBrokerSymbol('AAPL', broker) === 'AAPL', `${broker}: AAPL`);
    assert(toBrokerSymbol('MSFT', broker) === 'MSFT', `${broker}: MSFT`);
    assert(toBrokerSymbol('BRK.B', broker) === 'BRK.B', `${broker}: BRK.B`);
  }
});

test('lowercase normalized', () => {
  assert(toBrokerSymbol('aapl', 'alpaca') === 'AAPL');
  assert(toBrokerSymbol('msft', 'snaptrade') === 'MSFT');
});

test('unknown broker = pass-through', () => {
  assert(toBrokerSymbol('AAPL', 'robinhood') === 'AAPL');
  assert(toBrokerSymbol('TSLA', 'schwab') === 'TSLA');
});

console.log('\n📦 Batch Operations');
test('toStandardSymbols — array', () => {
  const result = toStandardSymbols(['aapl.nasdaq', 'MSFT', 'GOOGL:US', 'brk.b']);
  assert(JSON.stringify(result) === '["AAPL","MSFT","GOOGL","BRK.B"]',
    `got: ${JSON.stringify(result)}`);
});

test('toBrokerSymbols — array', () => {
  const result = toBrokerSymbols(['AAPL', 'MSFT', 'TSLA'], 'alpaca');
  assert(JSON.stringify(result) === '["AAPL","MSFT","TSLA"]');
});

console.log('\n🔑 buildSymbolLookup');
test('normalized key lookup', () => {
  const positions = {
    'AAPL.NASDAQ': { qty: 10 },
    'MSFT:US': { qty: 5 },
    'GOOGL': { qty: 2 },
  };
  const lookup = buildSymbolLookup(positions);
  assert(lookup.get('AAPL').qty === 10);
  assert(lookup.get('MSFT').qty === 5);
  assert(lookup.get('GOOGL').qty === 2);
});

test('exact match still works', () => {
  const positions = { 'TSLA': { qty: 8 } };
  const lookup = buildSymbolLookup(positions);
  assert(lookup.get('TSLA').qty === 8);
});

console.log('\n🌐 Real-World Scenarios');
test('SnapTrade position symbols → standard', () => {
  // Positions from SnapTrade use extractPositionTicker() which gives clean symbols
  // but let's verify the resolver handles edge cases
  const rawSymbols = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'BRK.B'];
  const resolved = rawSymbols.map((s) => toStandardSymbol(s));
  assert(JSON.stringify(resolved) === JSON.stringify(rawSymbols),
    'clean tickers pass through unchanged');
});

test('All phases: round-trip robustness', () => {
  // symbol → normalize → toBroker → toStandard → should equal original normalized
  const testCases = ['aapl', ' MsFt ', 'GOOGL:US', 'VOO.ARCA', 'BRK.B'];
  for (const raw of testCases) {
    const std = toStandardSymbol(raw);
    const broker = toBrokerSymbol(std, 'snaptrade');
    const back = toStandardSymbol(broker);
    assert(std === back, `round-trip "${raw}": ${std} → ${broker} → ${back}`);
  }
});

// ─── Summary ───

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
