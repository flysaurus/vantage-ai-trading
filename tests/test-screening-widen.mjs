/**
 * Test: Sector history extraction + widen detection
 * Helps verify the CLARIFY follow-up screening fix.
 */

// Inline copies of the new logic for testing (decoupled from route.ts)

const SECTOR_MAP = {
  tech: 'technology', technology: 'technology', software: 'technology', ai: 'technology',
  health: 'healthcare', healthcare: 'healthcare', pharma: 'healthcare', biotech: 'healthcare', medical: 'healthcare',
  finance: 'financial_services', financial: 'financial_services', banking: 'financial_services', banks: 'financial_services',
  energy: 'energy', oil: 'energy', gas: 'energy', renewable: 'energy', solar: 'energy',
  consumer: 'consumer_cyclical', retail: 'consumer_cyclical',
  industrial: 'industrials', industrials: 'industrials', manufacturing: 'industrials', aerospace: 'industrials', defense: 'industrials',
  materials: 'basic_materials', basic_materials: 'basic_materials', mining: 'basic_materials', minerals: 'basic_materials', metals: 'basic_materials',
  real_estate: 'real_estate', reit: 'real_estate', property: 'real_estate',
  utilities: 'utilities', utility: 'utilities',
  communication: 'communication_services', telecom: 'communication_services', media: 'communication_services',
};

function extractBudget(content) {
  const m = content.match(/\$?(\d[\d,]*)\s*(?:k|thousand)/i);
  if (m) return Math.round(parseFloat(m[1].replace(/,/g, '')) * 1000);
  const d = content.match(/\$?(\d[\d,]+)(?!\s*(?:k|thousand|%|x|p\/e))/i);
  if (d) return parseInt(d[1].replace(/,/g, ''));
  return null;
}

function extractSectorsFromHistory(messages) {
  const seen = new Set();
  const sectors = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const m = msg.content.toLowerCase();

    for (const [keyword, sector] of Object.entries(SECTOR_MAP)) {
      if (m.includes(keyword) && !seen.has(sector)) {
        seen.add(sector);
        sectors.unshift(sector);
      }
    }

    if (extractBudget(msg.content) !== null && sectors.length > 0) {
      break;
    }
  }

  return sectors.length > 0 ? sectors : null;
}

function detectWidenRequest(messages) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUser) return false;
  const m = lastUser.content.toLowerCase();
  const widenRe = new RegExp('widen|relax|loosen|drop.*filter|remove.*filter|expand|broaden|any (p/e|price)|all candidates', 'i');
  return widenRe.test(m);
}

function relaxCriteria(criteria) {
  const relaxed = { ...criteria };
  delete relaxed.pe_max;
  delete relaxed.min_growth_rate;
  relaxed.market_cap_min = Math.min(relaxed.market_cap_min || 500_000_000, 500_000_000);
  return relaxed;
}

// ─── Tests ───

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

console.log('\n📜 Sector History Extraction');

test('finds healthcare from first message in CLARIFY follow-up', () => {
  const msgs = [
    { role: 'user', content: 'Build me a 2k healthcare focused portfolio' },
    { role: 'ai', content: 'Only 0 matches...' },
    { role: 'user', content: 'Widen the screening filters to unlock more candidates' },
  ];
  const sectors = extractSectorsFromHistory(msgs);
  assert(sectors !== null, 'should find sectors');
  assert(sectors.includes('healthcare'), 'should include healthcare');
  assert(sectors.length === 1, 'should be exactly 1 sector');
});

test('finds tech sector when widen follow-up omits it', () => {
  const msgs = [
    { role: 'user', content: 'Build a $5k tech portfolio' },
    { role: 'user', content: 'Relax the PE filters' },
  ];
  const sectors = extractSectorsFromHistory(msgs);
  assert(sectors !== null, 'should find sectors');
  assert(sectors.includes('technology'), 'should include technology');
});

test('stops scanning at budget-bearing message', () => {
  const msgs = [
    { role: 'user', content: 'How are my holdings?' }, // no sector here
    { role: 'user', content: 'Build a 10k energy portfolio with low P/E' },
    { role: 'user', content: 'Drop the P/E filter' },
  ];
  const sectors = extractSectorsFromHistory(msgs);
  assert(sectors !== null);
  assert(sectors.includes('energy'), 'should find energy from budget message');
});

test('returns null when no sectors anywhere', () => {
  const msgs = [
    { role: 'user', content: 'Build a 2k portfolio' },
    { role: 'user', content: 'Widen filters please' },
  ];
  assert(extractSectorsFromHistory(msgs) === null, 'should be null');
});

test('multi-sector from history', () => {
  const msgs = [
    { role: 'user', content: 'Build me a 2k portfolio split between healthcare and tech' },
    { role: 'user', content: 'Remove all P/E caps' },
  ];
  const sectors = extractSectorsFromHistory(msgs);
  assert(sectors !== null);
  assert(sectors.includes('healthcare'));
  assert(sectors.includes('technology'));
});

console.log('\n🔍 Widen Request Detection');

test('detects "widen the screening filters"', () => {
  assert(detectWidenRequest([{ role: 'user', content: 'Widen the screening filters to unlock more candidates' }]));
});

test('detects "relax the criteria"', () => {
  assert(detectWidenRequest([{ role: 'user', content: 'Relax the criteria' }]));
});

test('detects "drop the P/E filter"', () => {
  assert(detectWidenRequest([{ role: 'user', content: 'Drop the P/E filter' }]));
});

test('detects "broaden the search"', () => {
  assert(detectWidenRequest([{ role: 'user', content: 'Broaden the search' }]));
});

test('detects "all candidates regardless of price"', () => {
  assert(detectWidenRequest([{ role: 'user', content: 'Show me all candidates regardless of price' }]));
});

test('does NOT detect normal portfolio request', () => {
  assert(!detectWidenRequest([{ role: 'user', content: 'Build me a 2k healthcare portfolio' }]));
});

console.log('\n🧹 Criteria Relaxation');

test('removes PE cap', () => {
  const relaxed = relaxCriteria({ pe_max: 30, market_cap_min: 2_000_000_000, min_growth_rate: 0.10 });
  assert(!('pe_max' in relaxed), 'pe_max should be removed');
  assert(!('min_growth_rate' in relaxed), 'min_growth_rate should be removed');
  assert(relaxed.market_cap_min === 500_000_000, 'market cap floor lowered');
});

test('preserves non-numeric fields like sector', () => {
  const relaxed = relaxCriteria({ pe_max: 25, sector: 'healthcare' });
  assert(relaxed.sector === 'healthcare', 'sector should be preserved');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'─'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
