// ─── Trade Gate ETF-Awareness Regression Test ─────────────────
// Proves Gate 1 no longer blocks valid ETFs. Before the fix, Gate 1 only
// consulted Finnhub `/stock/profile2`, which is equity-shaped and returns
// no data for funds — so every screener-recommended ETF buy was blocked as
// "not a recognized ticker symbol".
//
// This test simulates the real Finnhub behavior:
//   - `/stock/profile2` returns `{}` (no name/ticker) for ETF symbols
//   - `/etf/list` returns the US ETF universe the screener already trusts
//
// Run: npx tsx lib/ai/__tests__/trade-gate-etf.spec.ts

export {};

process.env.FINNHUB_IO_API_KEY = 'test-fake-key-for-gate';

// The 12 ETFs the ETF screener returned in this session's live tests,
// with the canonical names the screener displays to the user.
const SCREENER_ETFS: { symbol: string; name: string }[] = [
  { symbol: 'XBI', name: 'SPDR S&P Biotech ETF' },
  { symbol: 'XLV', name: 'Health Care Select Sector SPDR Fund' },
  { symbol: 'VHT', name: 'Vanguard Health Care ETF' },
  { symbol: 'IBB', name: 'iShares Biotechnology ETF' },
  { symbol: 'VGT', name: 'Vanguard Information Technology ETF' },
  { symbol: 'XLK', name: 'Technology Select Sector SPDR Fund' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', name: 'iShares Semiconductor ETF' },
  { symbol: 'XLF', name: 'Financial Select Sector SPDR Fund' },
  { symbol: 'VFH', name: 'Vanguard Financials ETF' },
  { symbol: 'XLI', name: 'Industrial Select Sector SPDR Fund' },
  { symbol: 'VIS', name: 'Vanguard Industrials ETF' },
];

const originalFetch = global.fetch;

function mockFetch(url: string, _opts?: any): Promise<any> {
  const urlStr = typeof url === 'string' ? url : String(url);

  // Equity profile: return empty object for ETFs (real Finnhub behavior)
  if (urlStr.includes('finnhub.io/api/v1/stock/profile2')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}), // no name/ticker → not a stock
    } as any);
  }

  // ETF discovery universe: return the screener's ETFs + descriptions
  if (urlStr.includes('finnhub.io/api/v1/etf/list')) {
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          SCREENER_ETFS.map((e) => ({ symbol: e.symbol, description: e.name })),
        ),
    } as any);
  }

  return originalFetch(url, _opts);
}

// @ts-expect-error — partial mock
global.fetch = mockFetch;

const { verifyTradeSymbol } = require('../trade-gate');

async function run() {
  console.log('\n═══ Trade Gate ETF-Awareness Tests ═══\n');

  let allowed = 0;
  let blocked = 0;

  for (const { symbol, name } of SCREENER_ETFS) {
    const result = await verifyTradeSymbol(symbol, null, null, name);
    if (result.allowed) {
      allowed++;
      console.log(`  ✅ ${symbol} — ALLOWED (${result.reason})`);
    } else {
      blocked++;
      console.log(`  ❌ ${symbol} — BLOCKED: ${result.reason}`);
    }
  }

  console.log('\n─── Controls ───\n');

  // Control 1: a nonexistent ticker must STILL be blocked
  const bad = await verifyTradeSymbol('ZZZZZ', null, null, 'Fake Company Inc.');
  if (!bad.allowed) {
    console.log('  ✅ ZZZZZ — still BLOCKED (safety preserved)');
  } else {
    console.log('  ❌ ZZZZZ — was ALLOWED (regression: gate too loose)');
    blocked++;
  }

  console.log(`\n─── Results: ${allowed}/${SCREENER_ETFS.length} ETFs allowed, ${blocked} blocked ───\n`);

  const failed = blocked > 0 || allowed !== SCREENER_ETFS.length;
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
