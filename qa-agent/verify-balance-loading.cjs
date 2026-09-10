// ─────────────────────────────────────────────────────────────
// VERIFY — Insights balance/health must NEVER print a placeholder number.
//
// Regression gate for the "$0.00 flash" bug: on a cold start the account is
// intentionally cleared by usePortfolio() (bridge gap) while `loading` is true.
// InsightsTab used to render its `equity: 0` fallback as if it were data, so
// the first thing a user saw was "$0.00" (and Portfolio Health flashed
// "0 / Needs attention"). The fix renders a SKELETON until the selected source
// really resolves.
//
// Scenario P (pending): broker account endpoint is HUNG → assert no digits at
//   all, shimmer present, health card marked pending.
// Scenario R (resolved): account answers after 2.5s → sample the whole cold
//   start at 50ms and assert the balance NEVER showed "$0", then lands on the
//   real number, and the health card returns to a real score.
//
// Requires: dev server on :3002, a FRESH session (node qa-agent/mint-session.cjs),
//           /tmp/vantage-positions.json.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const RESOLVE_MS = Number(process.env.RESOLVE_MS || 2500);
const WATCH_MS = Number(process.env.WATCH_MS || 20000);
const SHOT_DIR = process.env.SHOT_DIR || '/tmp/vantage-shots/balance-loading';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

const totalMV = pos.alpaca.reduce((s, r) => s + (r.market_value || 0), 0);
const alpacaCash = 25000;
const EQUITY = totalMV + alpacaCash;                                  // 126,679.657…
const EXPECTED_USD = '$' + Math.floor(EQUITY).toLocaleString('en-US'); // "$126,679"

const raw = pos.alpaca.map((r) => ({
  symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: r.qty,
  costBasis: (r.qty || 0) * (r.avg_cost || 0), price: r.current_price || r.avg_cost || 0,
  marketValue: r.market_value || 0, dayChange: 0, dayChangePct: 0,
  openPnl: r.unrealized_pnl || 0, currency: 'USD',
}));
const acct = {
  totalValue: EQUITY, cash: alpacaCash, buyingPower: alpacaCash,
  invested: totalMV, marketValue: totalMV, dayChange: 0, dayChangePct: 0,
  totalPnl: raw.reduce((s, p) => s + p.openPnl, 0), totalPnlPct: 0, currency: 'USD',
  accountStatus: 'open', lastSynced: new Date().toISOString(), holdingsUnavailable: false,
  positions: raw,
};
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: EQUITY, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];
const NOTICED = [{
  id: 'm1', triggerKey: 'concentration_single:m1', triggerType: 'concentration_single',
  title: 'Concentration risk', body: 'XLF is 30% of your portfolio.', followUp: '',
  variant: 'warn', icon: '⚖️', meta: { action: 'REBALANCE' }, action: 'REBALANCE',
  createdAt: new Date().toISOString(), dismissedUntil: null,
}];

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

// ── tiny check runner ──
let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
  results.push({ name, ok, detail });
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, payload]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', payload.acct);
      localStorage.setItem('vantage:theme', 'light');
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, { acct: `snaptrade:${ALPACA}` }]);

  /** Full mock set. `acctMode` = {delay} | {hang:true} */
  async function applyMocks(p, acctMode) {
    const acctHandler = acctMode.hang
      ? async () => { await new Promise((r) => setTimeout(r, 300000)); }
      : async (r) => {
          if (acctMode.delay) await new Promise((res) => setTimeout(res, acctMode.delay));
          await r.fulfill({ json: acct });
        };
    const acctPosHandler = acctMode.hang
      ? async () => { await new Promise((r) => setTimeout(r, 300000)); }
      : async (r) => {
          if (acctMode.delay) await new Promise((res) => setTimeout(res, acctMode.delay));
          await r.fulfill({ json: acct.positions });
        };
    await routePath(p, '/api/accounts', async (r) => {
      if (acctMode.delay) await new Promise((res) => setTimeout(res, acctMode.delay));
      await r.fulfill({ json: { accounts } });
    });
    await routePath(p, '/api/broker/status', (r) => r.fulfill({
      json: {
        connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER', connectionId: ALPACA,
        accountPreview: { id: ALPACA, provider: 'ALPACA-PAPER', name: 'Alpaca Paper' },
        environment: 'paper', trading_enabled: true, holdings_available: true,
      },
    }));
    await routePath(p, '/api/broker/snaptrade/account', acctHandler);
    await routePath(p, '/api/broker/snaptrade/positions', acctPosHandler);
    await routePath(p, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
    await routePath(p, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
    await routePath(p, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
    await routePath(p, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: 'MARKET: flat.' } }));
    await routePath(p, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: { content: 'SUMMARY: ok.' } }));
    await routePath(p, '/api/ai/noticed', (r) => r.fulfill({ json: { items: NOTICED } }));
    await routePath(p, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
    await routePath(p, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 } } } }));
  }

  /** One reading of the two gated surfaces. */
  const READ = () => {
    const card = document.querySelector('[data-testid="balance-card"]');
    const amount = document.querySelector('[data-testid="balance-amount"]');
    const health = document.querySelector('[data-testid="portfolio-health-card"]');
    const skel = document.querySelector('[data-testid="balance-skeleton"]');
    return {
      cardPresent: !!card,
      cardText: card ? card.innerText.replace(/\n/g, ' | ') : null,
      cardHasDollar: card ? /\$/.test(card.innerText) : null,
      amount: amount ? amount.textContent.trim() : null,
      skelPresent: !!skel,
      skelAnim: skel ? getComputedStyle(skel).animationName : null,
      skelBg: skel ? getComputedStyle(skel).backgroundImage.slice(0, 40) : null,
      healthPresent: !!health,
      healthScore: health ? health.getAttribute('data-health-score') : null,
      healthPending: health ? health.getAttribute('data-pending') : null,
      healthScoreNode: !!document.querySelector('[data-testid="health-score"]'),
      healthSubNode: !!document.querySelector('[data-testid="health-subscore-diversification"]'),
    };
  };

  // ═══════════════ Scenario P — PENDING (account hung) ═══════════════
  console.log('\n=== Scenario P — account endpoint hung (pending state) ===');
  const pPage = await ctx.newPage();
  await applyMocks(pPage, { hang: true });
  await pPage.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
  await pPage.waitForSelector('[data-testid="balance-card"]', { timeout: 45000 }).catch(() => {});
  await pPage.waitForSelector('[data-testid="balance-skeleton"]', { timeout: 20000 }).catch(() => {});
  await pPage.waitForTimeout(600);
  const P = await pPage.evaluate(READ);

  check('P1 balance card renders while pending', P.cardPresent === true, `cardPresent=${P.cardPresent}`);
  check('P2 pending balance shows a shimmer placeholder', P.skelPresent === true, `skel=${P.skelPresent}`);
  check('P3 shimmer is animated + token-driven', P.skelAnim === 'v-shimmer' && /gradient/.test(P.skelBg || ''), `animationName=${P.skelAnim} bg=${P.skelBg}…`);
  check('P4 NO dollar figure anywhere in the balance card', P.cardHasDollar === false, `cardText=${JSON.stringify(P.cardText)}`);
  check('P5 no balance-amount node exists (nothing to mis-read as $0.00)', P.amount === null, `amount=${JSON.stringify(P.amount)}`);
  check('P6 health card present but marked pending', P.healthPresent === true && P.healthPending === 'true', `pending=${P.healthPending}`);
  check('P7 health card exposes NO score attribute while pending', P.healthScore === null, `data-health-score=${JSON.stringify(P.healthScore)}`);
  check('P8 health score/sub-score nodes are absent while pending', P.healthScoreNode === false && P.healthSubNode === false, `scoreNode=${P.healthScoreNode} subNode=${P.healthSubNode}`);
  await pPage.locator('[data-testid="balance-block"]').screenshot({ path: `${SHOT_DIR}/P-balance-pending.png` }).catch(() => {});
  await pPage.locator('[data-testid="portfolio-health-card"]').screenshot({ path: `${SHOT_DIR}/P-health-pending.png` }).catch(() => {});
  await pPage.screenshot({ path: `${SHOT_DIR}/P-full-pending.png` }).catch(() => {});

  // ═══════════════ Scenario R — RESOLVED (2.5s broker latency) ═══════════════
  console.log(`\n=== Scenario R — cold start with ${RESOLVE_MS}ms broker latency ===`);
  const rPage = await ctx.newPage();
  await applyMocks(rPage, { delay: RESOLVE_MS });
  await rPage.goto(`${BASE}/?tab=insights`, { waitUntil: 'commit' });

  const timeline = [];
  let lastKey = null;
  const t0 = Date.now();
  let sawZero = false, sawSkel = false, sawReal = false, sawDigitsWhilePending = false;
  while (Date.now() - t0 < WATCH_MS) {
    let s = null;
    try { s = await rPage.evaluate(READ); } catch (e) { s = null; }
    if (s && s.cardPresent) {
      const key = `${s.amount}|${s.skelPresent}|${s.healthScore}|${s.cardHasDollar}`;
      if (key !== lastKey) { timeline.push({ t: Date.now() - t0, ...s }); lastKey = key; }
      if (s.amount === '$0') sawZero = true;
      if (s.skelPresent) { sawSkel = true; if (s.cardHasDollar) sawDigitsWhilePending = true; }
      if (s.amount === EXPECTED_USD) sawReal = true;
    }
    if (sawReal && s && !s.skelPresent) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log('  timeline (ms, amount, shimmer, health score):');
  for (const c of timeline) {
    console.log(`   +${String(c.t).padStart(6)}ms  amount=${JSON.stringify(c.amount)}  shimmer=${c.skelPresent}  health=${c.healthScore ?? 'pending'}`);
  }
  const final = await rPage.evaluate(READ);

  check('R1 the balance NEVER rendered "$0" during the cold start', sawZero === false, `distinct values: ${JSON.stringify(timeline.map((c) => c.amount))}`);
  check('R2 a shimmer (not a number) covered the loading window', sawSkel === true, `sawSkel=${sawSkel}`);
  check('R3 no digits were ever shown while the shimmer was up', sawDigitsWhilePending === false, `cardHasDollar during shimmer=${sawDigitsWhilePending}`);
  check('R4 balance lands on the REAL resolved number', final.amount === EXPECTED_USD, `amount=${JSON.stringify(final.amount)} expected=${EXPECTED_USD}`);
  check('R5 balance-amount node present once ready (contract preserved)', final.amount !== null, `amount=${JSON.stringify(final.amount)}`);
  check('R6 shimmer is gone once resolved', final.skelPresent === false, `skel=${final.skelPresent}`);
  check('R7 health card back to a real deterministic score', final.healthPending === null && final.healthScore !== null && Number(final.healthScore) > 0, `score=${final.healthScore} pending=${final.healthPending}`);
  check('R8 health score/sub-score nodes rendered again', final.healthScoreNode === true && final.healthSubNode === true, `scoreNode=${final.healthScoreNode} subNode=${final.healthSubNode}`);
  check(
    'R9 Today/Total row hidden while pending, present once ready',
    !/Today/.test(P.cardText || '') && /Today/.test(final.cardText || ''),
    `pendingCard=${JSON.stringify(P.cardText)} readyCard=${JSON.stringify((final.cardText || '').slice(0, 120))}`,
  );
  await rPage.screenshot({ path: `${SHOT_DIR}/R-full-resolved.png` }).catch(() => {});
  await rPage.locator('[data-testid="balance-block"]').screenshot({ path: `${SHOT_DIR}/R-balance-resolved.png` }).catch(() => {});

  await browser.close();

  console.log(`\n──────── ${pass}/${pass + fail} checks passed ────────`);
  fs.writeFileSync(`${SHOT_DIR}/results.json`, JSON.stringify({ pass, fail, results }, null, 2));
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
