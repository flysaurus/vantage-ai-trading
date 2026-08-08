// Quick smoke: trade-gate name matching logic (with alias expansion)
// Run: npx tsx lib/ai/__tests__/trade-gate-smoke.ts

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(?:inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|se|nv|bv|co\.?|company|holdings?|group|international|technologies?|therapeutics?|biosciences?|pharmaceuticals?)\b/gi,
      '',
    )
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const COMPANY_ALIASES: Record<string, string[]> = {
  google: ['alphabet'],
  alphabet: ['google'],
  facebook: ['meta platforms', 'meta'],
  'meta platforms': ['facebook'],
  meta: ['facebook'],
  alibaba: ['alibaba group holding'],
  baba: ['alibaba group holding'],
};

function expandWithAliases(normalizedName: string): string[] {
  const results = [normalizedName];
  if (COMPANY_ALIASES[normalizedName]) {
    results.push(...COMPANY_ALIASES[normalizedName]);
  }
  for (const word of normalizedName.split(' ').filter(w => w.length > 1)) {
    if (COMPANY_ALIASES[word]) {
      results.push(...COMPANY_ALIASES[word]);
    }
  }
  return results;
}

function namesMatch(nameA: string, nameB: string): boolean {
  const normA = normalizeCompanyName(nameA);
  const normB = normalizeCompanyName(nameB);
  const aliasesA = expandWithAliases(normA);
  const aliasesB = expandWithAliases(normB);

  for (const a of aliasesA) {
    for (const b of aliasesB) {
      if (a === b) return true;
      if (a.includes(b) || b.includes(a)) return true;
      const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
      const wordsB = new Set(b.split(' ').filter(w => w.length > 1));
      if (wordsA.size === 0 || wordsB.size === 0) continue;
      const shorter = wordsA.size <= wordsB.size ? wordsA : wordsB;
      const longer = wordsA.size > wordsB.size ? wordsA : wordsB;
      const overlap = [...shorter].filter(w => longer.has(w)).length;
      if (overlap / shorter.size >= 0.5) return true;
    }
  }
  return false;
}

interface TestCase { a: string; b: string; expect: boolean; label: string }
const tests: TestCase[] = [
  // ── Original 15: basic matching ──
  { a: 'Apple Inc.', b: 'Apple Inc', expect: true, label: 'same company, with/without period' },
  { a: 'NVIDIA Corporation', b: 'NVIDIA Corp', expect: true, label: 'same company, corp abbreviation' },
  { a: 'Microsoft Corporation', b: 'Microsoft', expect: true, label: 'full name vs short name' },
  { a: 'Annexon Biosciences', b: 'Annexon', expect: true, label: 'biosciences suffix stripped' },
  { a: 'SK Hynix Inc.', b: 'SK Hynix', expect: true, label: 'Korean company with suffix' },
  { a: 'Annexon Biosciences', b: 'Cimpress PLC', expect: false, label: 'DIFFERENT — Annexon vs Cimpress' },
  { a: 'Annexon', b: 'Cimpress', expect: false, label: 'DIFFERENT — short names' },
  { a: 'Alphabet Inc.', b: 'Meta Platforms Inc.', expect: false, label: 'DIFFERENT — tech giants' },
  { a: 'Tesla Inc.', b: 'Tesla Motors', expect: true, label: 'Tesla old name vs new' },
  { a: 'Berkshire Hathaway Inc.', b: 'Berkshire Hathaway', expect: true, label: 'suffix stripped' },
  { a: 'JPMorgan Chase & Co.', b: 'JPMorgan Chase', expect: true, label: 'bank with ampersand' },
  { a: 'Vanguard S&P 500 ETF', b: 'Vanguard 500 Index Fund ETF', expect: true, label: 'VOO variations' },
  { a: 'Palantir Technologies Inc.', b: 'Palantir', expect: true, label: 'technologies stripped' },
  { a: 'ANNX', b: 'Annexon Biosciences', expect: false, label: 'DIFFERENT — ticker vs name' },
  { a: 'Annexon Biosciences Inc.', b: 'Annexon Biosciences Inc.', expect: true, label: 'exact same' },

  // ── NEW: Colloquial / common-name aliases ──
  { a: 'Alphabet Inc.', b: 'Google', expect: true, label: 'Alphabet = Google (alias)' },
  { a: 'Alphabet Inc.', b: 'Google LLC', expect: true, label: 'Alphabet Inc. = Google LLC (alias + suffix strip)' },
  { a: 'Meta Platforms Inc.', b: 'Facebook', expect: true, label: 'Meta = Facebook (alias)' },
  { a: 'Meta Platforms', b: 'Facebook Inc.', expect: true, label: 'Meta Platforms = Facebook Inc. (alias + suffix)' },
  { a: 'Alibaba Group Holding Ltd.', b: 'Alibaba', expect: true, label: 'Alibaba Group = Alibaba (suffix strip)' },
  { a: 'Alibaba Group Holding', b: 'BABA', expect: true, label: 'Alibaba Group = BABA (ticker alias)' },

  // ── Still-correct negatives ──
  { a: 'Google', b: 'Meta Platforms', expect: false, label: 'DIFFERENT — Google ≠ Meta' },
  { a: 'Facebook', b: 'Apple', expect: false, label: 'DIFFERENT — Facebook ≠ Apple' },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = namesMatch(t.a, t.b);
  const ok = result === t.expect;
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: "${t.a}" vs "${t.b}" — expected ${t.expect}, got ${result} (${t.label})`);
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
