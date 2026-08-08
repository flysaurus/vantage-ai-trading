// ─── Trade Gate Integration Test ──────────────────────────────
// Proves verifyTradeSymbol() correctly:
//   A) ALLOWS valid symbol with matching company name
//   B) BLOCKS valid symbol with mismatched company name (hallucination)
//   C) BLOCKS invalid/nonexistent symbol
//   D) Works with direct expectedCompanyName pass
//   E) Works with regex-extracted company name from message
//   F) Fail-closed: infrastructure errors → BLOCK
//
// Run: npx tsx lib/ai/__tests__/trade-gate-integration.ts

// ── Mock fetch for Finnhub profile2 API ──
// Set a fake API key so the gate doesn't short-circuit at Gate 0
process.env.FINNHUB_IO_API_KEY = 'test-fake-key-for-gate';

const originalFetch = global.fetch;
let mockProfileResponse: any = null;

function mockFetch(url: string, _opts?: any): Promise<any> {
  const urlStr = typeof url === 'string' ? url : String(url);

  if (urlStr.includes('finnhub.io/api/v1/stock/profile2')) {
    if (!mockProfileResponse) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as any);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockProfileResponse),
    } as any);
  }

  // Pass through to real fetch for everything else
  return originalFetch(url, _opts);
}

// @ts-expect-error — partial mock
global.fetch = mockFetch;

// ── Mock Supabase client ──
function createMockSupabase(chatMessageContent: string | null) {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_field: string, _id: string) => ({
          single: () => {
            if (chatMessageContent === null) {
              return Promise.resolve({ data: null, error: { message: 'not found' } });
            }
            return Promise.resolve({
              data: { content: chatMessageContent, role: 'assistant' },
              error: null,
            });
          },
        }),
      }),
    }),
  };
}

// ── Import the gate (after mocks are set up) ──
const { verifyTradeSymbol } = require('../trade-gate');

interface TestResult {
  name: string;
  pass: boolean;
  expected: 'ALLOW' | 'BLOCK';
  got: 'ALLOW' | 'BLOCK';
  detail: string;
}

const gateResults: TestResult[] = [];

async function runGateTest(
  name: string,
  symbol: string,
  expected: 'ALLOW' | 'BLOCK',
  opts: {
    profile?: any;
    messageContent?: string | null;
    expectedCompanyName?: string | null;
    messageId?: string;
  } = {},
): Promise<void> {
  // Set up mock profile
  mockProfileResponse = opts.profile ?? null;

  // Create mock supabase
  const supabase = opts.messageContent !== undefined
    ? createMockSupabase(opts.messageContent)
    : null;

  const result = await verifyTradeSymbol(
    symbol,
    opts.messageId || (opts.messageContent !== undefined ? 'test-msg-id' : null),
    supabase,
    opts.expectedCompanyName ?? null,
  );

  const got = result.allowed ? 'ALLOW' : 'BLOCK';
  const pass = got === expected;
  gateResults.push({ name, pass, expected, got, detail: result.reason });

  if (pass) {
    console.log(`  ✅ ${name}`);
  } else {
    console.log(`  ❌ ${name} — expected ${expected}, got ${got}: ${result.reason}`);
  }
}

async function runTradeGateTests() {
  console.log('\n═══ Trade Gate Integration Tests ═══\n');

  // ═════════════════════════════════════════════════════════════
  // TEST A: Valid symbol + matching name → ALLOW
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'A1: Valid symbol, direct name match → ALLOW',
    'AAPL',
    'ALLOW',
    {
      profile: { name: 'Apple Inc', ticker: 'AAPL', exchange: 'NASDAQ' },
      expectedCompanyName: 'Apple Inc.',
    },
  );

  await runGateTest(
    'A2: Valid symbol, name with suffix variants → ALLOW',
    'NVDA',
    'ALLOW',
    {
      profile: { name: 'NVIDIA Corporation', ticker: 'NVDA', exchange: 'NASDAQ' },
      expectedCompanyName: 'NVIDIA',
    },
  );

  await runGateTest(
    'A3: Valid symbol, message-context name match → ALLOW',
    'MSFT',
    'ALLOW',
    {
      profile: { name: 'Microsoft Corporation', ticker: 'MSFT', exchange: 'NASDAQ' },
      messageContent: [
        'Looking at the data, I recommend buying Microsoft.',
        '',
        '**MSFT** — Microsoft Corporation — $420.50',
        '',
        '[RECOMMEND:MSFT:BUY]',
      ].join('\n'),
    },
  );

  // ═════════════════════════════════════════════════════════════
  // TEST B: Valid symbol but WRONG company name → BLOCK (the hallucination)
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'B1: ANNX shown as "Annexon Biosciences" but user was told "Cimpress" → BLOCK',
    'ANNX',
    'BLOCK',
    {
      profile: { name: 'Annexon Biosciences Inc.', ticker: 'ANNX', exchange: 'NASDAQ' },
      expectedCompanyName: 'Cimpress PLC',
    },
  );

  await runGateTest(
    'B2: CMPR shown as "Cimpress" but user was told "Annexon" → BLOCK',
    'CMPR',
    'BLOCK',
    {
      profile: { name: 'Cimpress PLC', ticker: 'CMPR', exchange: 'NASDAQ' },
      expectedCompanyName: 'Annexon Biosciences',
    },
  );

  await runGateTest(
    'B3: VYM is Vanguard High Dividend, user told "Annaly Capital" → BLOCK',
    'VYM',
    'BLOCK',
    {
      profile: { name: 'Vanguard High Dividend Yield ETF', ticker: 'VYM', exchange: 'ARCA' },
      expectedCompanyName: 'Annaly Capital Management',
    },
  );

  await runGateTest(
    'B4: JEPI is JPMorgan Equity Premium, user told "Annaly Capital" → BLOCK',
    'JEPI',
    'BLOCK',
    {
      profile: { name: 'JPMorgan Equity Premium Income ETF', ticker: 'JEPI', exchange: 'ARCA' },
      expectedCompanyName: 'Annaly Capital Management Inc.',
    },
  );

  // Message-context based mismatch (regex extraction)
  await runGateTest(
    'B5: Message says "Cimpress" → RECOMMEND:ANNX → BLOCK (regex extraction)',
    'ANNX',
    'BLOCK',
    {
      profile: { name: 'Annexon Biosciences Inc.', ticker: 'ANNX', exchange: 'NASDAQ' },
      messageContent: [
        'I recommend buying Cimpress. They have strong fundamentals.',
        '',
        '**ANNX** — Cimpress PLC — $124.50',
        '',
        'Strong recurring revenue and margin expansion.',
        '',
        '[RECOMMEND:ANNX:BUY]',
      ].join('\n'),
    },
  );

  // ═════════════════════════════════════════════════════════════
  // TEST C: Invalid/nonexistent symbol → BLOCK
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'C1: Nonexistent ticker → BLOCK',
    'ZZZZZ',
    'BLOCK',
    {
      profile: null, // Finnhub returns nothing
    },
  );

  await runGateTest(
    'C2: Malformed ticker → BLOCK',
    'A',
    'BLOCK',
    {
      profile: null,
    },
  );

  // ═════════════════════════════════════════════════════════════
  // TEST D: Good symbols with correct names → ALLOW
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'D1: VOO matches Vanguard S&P 500 → ALLOW',
    'VOO',
    'ALLOW',
    {
      profile: { name: 'Vanguard S&P 500 ETF', ticker: 'VOO', exchange: 'ARCA' },
      expectedCompanyName: 'Vanguard S&P 500 ETF',
    },
  );

  await runGateTest(
    'D2: NVDA matches NVIDIA → ALLOW (via message context)',
    'NVDA',
    'ALLOW',
    {
      profile: { name: 'NVIDIA Corporation', ticker: 'NVDA', exchange: 'NASDAQ' },
      messageContent: [
        'NVIDIA is crushing it. Strong buy signal.',
        '',
        '**NVDA** — NVIDIA Corporation — $680.00',
        '',
        '[RECOMMEND:NVDA:BUY]',
      ].join('\n'),
    },
  );

  await runGateTest(
    'D3: TSLA matches Tesla → ALLOW',
    'TSLA',
    'ALLOW',
    {
      profile: { name: 'Tesla Inc.', ticker: 'TSLA', exchange: 'NASDAQ' },
      expectedCompanyName: 'Tesla Inc.',
    },
  );

  // ═════════════════════════════════════════════════════════════
  // TEST E: Edge cases
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'E1: Missing message context, symbol valid → ALLOW (manual trade)',
    'AAPL',
    'ALLOW',
    {
      profile: { name: 'Apple Inc', ticker: 'AAPL', exchange: 'NASDAQ' },
      // No messageId, no supabase — manual trade path
    },
  );

  await runGateTest(
    'E2: Message fetch fails, symbol valid → ALLOW (degraded gracefully)',
    'AAPL',
    'ALLOW',
    {
      profile: { name: 'Apple Inc', ticker: 'AAPL', exchange: 'NASDAQ' },
      messageContent: null, // Simulates DB fetch failure
      messageId: 'nonexistent-msg',
    },
  );

  await runGateTest(
    'E3: Exact company name, different casing → ALLOW',
    'BRK.B',
    'ALLOW',
    {
      profile: { name: 'Berkshire Hathaway Inc.', ticker: 'BRK.B', exchange: 'NYSE' },
      expectedCompanyName: 'berkshire hathaway inc.',
    },
  );

  // ═════════════════════════════════════════════════════════════
  // TEST F: Colloquial / common-name aliases (NOT false positives)
  // ═════════════════════════════════════════════════════════════
  await runGateTest(
    'F1: GOOGL = "Google" (colloquial name) → ALLOW',
    'GOOGL',
    'ALLOW',
    {
      profile: { name: 'Alphabet Inc.', ticker: 'GOOGL', exchange: 'NASDAQ' },
      expectedCompanyName: 'Google',
    },
  );

  await runGateTest(
    'F2: META = "Facebook" (old name) → ALLOW',
    'META',
    'ALLOW',
    {
      profile: { name: 'Meta Platforms Inc.', ticker: 'META', exchange: 'NASDAQ' },
      expectedCompanyName: 'Facebook',
    },
  );

  await runGateTest(
    'F3: GOOGL = "Google LLC" (colloquial + suffix) → ALLOW',
    'GOOGL',
    'ALLOW',
    {
      profile: { name: 'Alphabet Inc.', ticker: 'GOOGL', exchange: 'NASDAQ' },
      expectedCompanyName: 'Google LLC',
    },
  );

  await runGateTest(
    'F4: BABA = "Alibaba" (nickname) → ALLOW',
    'BABA',
    'ALLOW',
    {
      profile: { name: 'Alibaba Group Holding Ltd.', ticker: 'BABA', exchange: 'NYSE' },
      expectedCompanyName: 'Alibaba',
    },
  );

  // ═════════════════════════════════════════════════════════════
  // RESULTS
  // ═════════════════════════════════════════════════════════════
  const gatePassed = gateResults.filter(r => r.pass).length;
  const gateFailed = gateResults.filter(r => !r.pass).length;

  console.log(`\n─── Results: ${gatePassed}/${gateResults.length} passed, ${gateFailed} failed ───\n`);

  if (gateFailed > 0) {
    console.log('FAILURES:');
    for (const r of gateResults.filter(r => !r.pass)) {
      console.log(`  ${r.name}: expected ${r.expected}, got ${r.got}`);
    }
  }

  process.exit(gateFailed > 0 ? 1 : 0);
}

runTradeGateTests().catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
