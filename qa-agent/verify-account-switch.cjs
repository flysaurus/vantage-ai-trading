// ─────────────────────────────────────────────────────────────
// PART 2 — cross-account stale balance flash.
//
// Em's report (confirmed via screenshot): switching accounts (Fidelity →
// Alpaca Paper) briefly renders the PREVIOUS account's REAL balance before the
// new account's data lands.
//
// This harness produces the evidence, in two modes:
//
//   MODE=bug    → run against PRE-FIX code. Asserts the bug is REPRODUCIBLE and
//                 dumps screenshots of the stale render. Passes when the flash
//                 is observed (i.e. the harness genuinely detects the bug).
//   MODE=fixed  → run against the fixed code. Asserts the previous account's
//                 real number is NEVER shown after the switch and that a
//                 loading/skeleton state appears first.
//
// Method: per-account broker mocks (keyed on the ?connectionId= query param the
// HTTP layer threads through), the NEW account's endpoints delayed so the
// refetch window is wide and observable, and a 25ms in-page sampler installed
// at document-start that records every distinct balance the DOM ever shows.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.APP_BASE || 'http://localhost:3002';
const MODE = (process.env.MODE || 'fixed').toLowerCase();
const ENTRY = (process.env.ENTRY || 'portfolio').toLowerCase();
const REF = 'ixjnuoslbzytubpplkot';
const DELAY_B = Number(process.env.DELAY_B || 2500);
const OUT = process.env.SHOT_DIR || `/tmp/vantage-shots/account-switch/${MODE}-${ENTRY}`;
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));

const FID = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';   // account A (currently active)
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207'; // account B (the switch target)

const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

/* ── fixtures: two accounts with clearly different real balances ── */
const rows = pos.alpaca;
const mvB = rows.reduce((s, r) => s + (r.market_value || 0), 0);
const cashB = 25000;
const EQUITY_A = 101679.657;  // → "$101,680"
const EQUITY_B = mvB + cashB; // → "$126,679"
const maxFrac0 = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const maxFrac2 = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
const A_TOTAL = maxFrac0(EQUITY_A);
const B_TOTAL = maxFrac2(EQUITY_B);
// The UI may round or truncate, and may split dollars/cents into sibling nodes —
// match on the grouped-digit form with every plausible rounding.
const variants = (v) => [...new Set([maxFrac0(v), maxFrac2(v), Math.floor(v).toLocaleString('en-US')])];
const A_VARIANTS = variants(EQUITY_A);
const B_VARIANTS = variants(EQUITY_B);

function rawPositions(list) {
  return list.map((r) => ({
    symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: r.qty,
    costBasis: (r.qty || 0) * (r.avg_cost || 0), price: r.current_price || r.avg_cost || 0,
    marketValue: r.market_value || 0, dayChange: 0, dayChangePct: 0,
    openPnl: r.unrealized_pnl || 0, currency: 'USD',
  }));
}
function acctFor(equity, list, cash) {
  const positions = rawPositions(list);
  const mv = positions.reduce((s, p) => s + p.marketValue, 0);
  return {
    totalValue: equity, cash, buyingPower: cash, invested: mv, marketValue: mv,
    dayChange: 0, dayChangePct: 0, totalPnl: positions.reduce((s, p) => s + p.openPnl, 0),
    totalPnlPct: 0, currency: 'USD', accountStatus: 'open',
    lastSynced: new Date().toISOString(), holdingsUnavailable: false, positions,
  };
}
// A = Fidelity: same shape, different (and clearly distinct) balance.
const ACCT_A = acctFor(EQUITY_A, rows, 0);
const ACCT_B = acctFor(EQUITY_B, rows, cashB);

const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${FID}`, name: 'Fidelity Investments', broker: 'Fidelity', brokerageSlug: 'FIDELITY', isDemo: false, tradingEnabled: false, totalValue: EQUITY_A, buyingPower: 0, cash: 0, environment: 'live', connectionId: FID },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: EQUITY_B, buyingPower: cashB, cash: cashB, environment: 'paper', connectionId: ALPACA },
];

const NOTICED = [{
  id: 'n1', triggerKey: 'concentration_single:n1', triggerType: 'concentration_single',
  title: 'Concentration risk', body: 'XLF is 30% of your portfolio.', followUp: '',
  variant: 'warn', icon: '⚖️', meta: { action: 'REBALANCE' }, action: 'REBALANCE',
  createdAt: new Date().toISOString(), dismissedUntil: null,
}];

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);

  // Start on account A, with a 25ms sampler armed before any app code runs.
  await ctx.addInitScript(([lsv, acct, A_V, B_V]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      localStorage.setItem('vantage:theme', 'light');
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
    window.__sw = [];
    window.__swT0 = null;
    const snap = (kind) => {
      const bal = document.querySelector('[data-testid="balance-amount"]');
      const hero = document.querySelector('[data-testid="account-hero"], [data-testid="account-summary-card"]');
      // The hero balance renders as sibling spans ("$" + "126,679" + ".66"), so a
      // leaf-by-leaf dollar scan misses it — search the flat document text instead.
      const txt = (document.body && document.body.textContent) || '';
      window.__sw.push({
        kind,
        t: Math.round(performance.now()),
        rel: window.__swT0 == null ? null : Math.round(performance.now() - window.__swT0),
        bal: bal ? bal.textContent.trim() : null,
        hero: hero ? hero.innerText.slice(0, 70).replace(/\n/g, ' | ') : null,
        a: A_V.some((v) => txt.includes(v)),
        b: B_V.some((v) => txt.includes(v)),
        spinner: /Loading portfolio data/i.test(txt),
        skel: !!document.querySelector('[data-testid="balance-skeleton"]'),
      });
      if (window.__sw.length > 8000) window.__sw.shift();
    };
    setInterval(() => snap('dom'), 25);
    // A stale DOM at a rAF callback means the frame ABOUT TO PAINT shows the old
    // account's number — i.e. a genuinely user-visible stale frame (a DOM sample
    // between the tap and React's commit is not, since it never paints).
    const rafLoop = () => { snap('raf'); requestAnimationFrame(rafLoop); };
    requestAnimationFrame(rafLoop);
  }, [localSession, `snaptrade:${FID}`, A_VARIANTS, B_VARIANTS]);

  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('   [PAGEERROR]', String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (/usePortfolio|account switched|discarding stale|portfolio context/i.test(t)) {
      console.log(`   🖥  [console] ${t.slice(0, 190)}`);
    }
  });

  // Per-account broker responses, keyed on the connectionId query param.
  await routePath(page, '/api/auth/me', (r) => r.fulfill({ json: { user: {
    id: session.user.id, email: session.user.email, first_name: 'Milind', last_name: 'Parikh',
    investor_style: 'soros', risk_tolerance: 'moderate', tier: 'demo',
    demo_start_at: '2026-07-03T19:00:00+00:00', demo_expires_at: null,
    connection_type: null, connection_status: null,
    investor_style_onboarded: true, investorStyleOnboarded: true,
    investorStyle: 'soros', riskTolerance: 'moderate',
  } } }));
  await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
  await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
    connected: true, brokerId: 'snaptrade', underlying_broker: 'FIDELITY', connectionId: FID,
    accountPreview: { id: FID, provider: 'FIDELITY', name: 'Fidelity Investments' },
    environment: 'live', trading_enabled: false, holdings_available: true,
  }}));
  await routePath(page, '/api/broker/snaptrade/account', async (r) => {
    const url = new URL(r.request().url());
    const cid = url.searchParams.get('connectionId');
    const isB = cid === ALPACA;
    if (isB) { console.log(`   ⏱  account(B) request — delaying ${DELAY_B}ms`); await new Promise((res) => setTimeout(res, DELAY_B)); }
    console.log(`   ⏱  served account(${isB ? 'B/Alpaca' : 'A/Fidelity'}) @ +${((Date.now() - T0) / 1000).toFixed(2)}s`);
    await r.fulfill({ json: isB ? ACCT_B : ACCT_A });
  });
  await routePath(page, '/api/broker/snaptrade/positions', async (r) => {
    const cid = new URL(r.request().url()).searchParams.get('connectionId');
    const isB = cid === ALPACA;
    if (isB) await new Promise((res) => setTimeout(res, DELAY_B));
    await r.fulfill({ json: (isB ? ACCT_B : ACCT_A).positions });
  });
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: 'MARKET: flat.' } }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: { content: 'SUMMARY: ok.' } }));
  await routePath(page, '/api/ai/noticed', (r) => r.fulfill({ json: { items: NOTICED } }));
  await routePath(page, '/api/ai/noticed/dismiss', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
  await routePath(page, '/api/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"text":"mocked"}\n\ndata: [DONE]\n\n' }));

  // ── 1. load with account A active, wait for A's REAL balance to be on screen ──
  page.setDefaultNavigationTimeout(120000);
  let T0 = Date.now();
  // Warm the dev server first: the first hit to a route compiles it, which would
  // otherwise eat the whole watch window.
  await page.goto(`${BASE}/?tab=${ENTRY}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  T0 = Date.now();
  console.log(`\n(loading as A = Fidelity, expecting $${A_TOTAL})`);
  await page.goto(`${BASE}/?tab=${ENTRY}`, { waitUntil: 'domcontentloaded' });
  // The app shows a branded splash while auth/app-state resolve — wait for the
  // REAL shell with A's number rendered, not just for the document.
  let sawA = false;
  try {
    await page.waitForFunction((list) => {
      const t = (document.body && document.body.textContent) || '';
      return list.some((v) => t.includes(v));
    }, A_VARIANTS, { timeout: 90000 });
    sawA = true;
  } catch (e) { sawA = false; }
  await page.waitForTimeout(600);
  if (!sawA || process.env.DUMP === '1') {
    console.log('  ── BODY DUMP ──');
    const info = await page.evaluate(() => ({
      htmlLen: document.body ? document.body.innerHTML.length : -1,
      htmlHead: document.body ? document.body.innerHTML.slice(0, 400).replace(/\s+/g, ' ') : '',
      text: document.body ? document.body.textContent.slice(0, 400) : '',
      url: location.href,
      shell: !!document.querySelector('.app-shell'),
      visible: (() => { const s = document.querySelector('.app-shell'); if (!s) return null; const cs = getComputedStyle(s); return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, h: s.getBoundingClientRect().height }; })(),
    }));
    console.log(JSON.stringify(info, null, 2));
    await page.screenshot({ path: `${OUT}/0-debug-load.png` });
  }
  rec('S0 Account A (Fidelity) real balance is on screen before the switch', sawA, `looking for $${A_TOTAL}`);
  await page.screenshot({ path: `${OUT}/1-before-switch-account-A.png` });
  const beforeShot = await page.locator('body').innerText();

  // ── 2. open the switcher ──
  const trigger = (await page.$("[data-testid=\"account-switcher\"]")) || (await page.$("button:has-text(\"Fidelity\")"));
  rec('S1 Account switcher trigger is reachable', !!trigger);
  if (!trigger) { await ctx.close(); await browser.close(); process.exit(1); }
  await trigger.evaluate((el) => el.click());
  await page.waitForTimeout(500);
  const menuOpen = await page.evaluate(() => !!document.querySelector('[data-testid="account-switcher-menu"]') || !!document.querySelector('[role="listbox"]'));
  rec('S2 Switcher opens its account list', menuOpen);
  await page.screenshot({ path: `${OUT}/2-switcher-open.png` });

  // ── 3. switch to B, then watch every frame ──
  T0 = Date.now();
  // Pre-fix builds have no data-account-id on the options — fall back to
  // role=option + text. `page.$` never waits, so a miss is cheap here.
  let option = await page.$(`[data-account-id="snaptrade:${ALPACA}"]`);
  if (!option) option = await page.$('[data-testid="account-switcher-item"]:has-text("Alpaca Paper")');
  if (!option) option = await page.$('[role="option"]:has-text("Alpaca Paper")');
  if (!option) option = await page.$('div:has-text("Alpaca Paper") >> nth=-1');
  rec('S3 Alpaca option present in the list', !!option);
  if (!option) { await ctx.close(); await browser.close(); process.exit(1); }
  // Stamp T0 in the SAME evaluate as the click: rel=0 is the click instant, so a
  // frame sampled at rel>0 is genuinely a post-click frame (anything stamped
  // earlier would wrongly count pre-click frames as "after the switch").
  await option.evaluate((el) => { window.__swT0 = performance.now(); el.click(); });
  const clickAt = Date.now();

  // frame-accurate captures while the new account loads
  const shots = [150, 600, 1500, 2800];
  for (const ms of shots) {
    await page.waitForTimeout(ms - (Date.now() - clickAt));
    await page.screenshot({ path: `${OUT}/3-after-switch-+${ms}ms.png` });
  }
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/4-final-account-B.png` });

  // ── 4. analyse the sampler ──
  const samples = await page.evaluate(() => window.__sw || []);
  const after = samples.filter((s) => s.rel != null && s.rel >= 0);
  // Compare on the grouped-digits form so a split dollars/cents render (or an
  // extra decimal) still counts as "this account's number".
  const hasA = (s) => !!s.a;
  const hasB = (s) => !!s.b;
  const rafSamples = after.filter((s) => s.kind === 'raf');

  const stale = after.filter(hasA);
  const fresh = after.filter(hasB);
  // Painted-frame truth: only frames (rAF) can show a value to the user.
  const staleFrames = rafSamples.filter(hasA);
  const staleFrameMs = staleFrames.length ? staleFrames[staleFrames.length - 1].rel - staleFrames[0].rel : 0;
  const loadingSamples = after.filter((s) => s.spinner || s.skel);

  const firstStale = stale[0];
  const lastStale = stale[stale.length - 1];
  const firstFresh = fresh[0];
  const staleMs = stale.length ? lastStale.rel - firstStale.rel : 0;

  console.log('\n  timeline (ms after the switch tap → distinct DOM balance states):');
  let lastKey = null;
  for (const s of after) {
    const key = `${s.a ? 'A' : ''}${s.b ? 'B' : ''}|${s.spinner}|${s.skel}`;
    if (key === lastKey) continue;
    lastKey = key;
    console.log(`   +${String(s.rel).padStart(5)}ms  A=${s.a}  B=${s.b}  spinner=${s.spinner}  skeleton=${s.skel}  bal=${JSON.stringify(s.bal)}`);
  }
  console.log(`  rendered FRAMES (rAF) after the switch: ${rafSamples.length}; frames showing A's number: ${staleFrames.length}${staleFrames.length ? ` (+${staleFrames[0].rel}ms → +${staleFrames[staleFrames.length - 1].rel}ms)` : ''}`);
  console.log(`\n  A's number ($${A_TOTAL}${A_VARIANTS.length > 1 ? '/' + A_VARIANTS[A_VARIANTS.length - 1] : ''}) visible after the switch: ${stale.length ? `YES — +${firstStale.rel}ms → +${lastStale.rel}ms (${staleMs}ms)` : 'NO'}`);
  console.log(`  B's number ($${B_TOTAL}) first seen: ${firstFresh ? `+${firstFresh.rel}ms` : 'never'}`);
  console.log(`  loading/skeleton states after switch: ${loadingSamples.length ? `+${loadingSamples[0].rel}ms → +${loadingSamples[loadingSamples.length - 1].rel}ms (${loadingSamples.length} samples)` : 'NONE'}`);
  fs.writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ mode: MODE, entry: ENTRY, eqA: EQUITY_A, eqB: EQUITY_B, stale, fresh: fresh.slice(0, 5), loadingSamples: loadingSamples.slice(0, 5), sampleCount: after.length, beforeShot: beforeShot.slice(0, 300) }, null, 2));

  if (MODE === 'bug') {
    // Reproducing the bug is the PASS condition here — this is the "before" evidence.
    rec('B0 PRE-FIX: stale number is VISIBLE in rendered frames (not just the DOM)',
      staleFrames.length > 0, `${staleFrames.length} frames, +${staleFrames[0] ? staleFrames[0].rel : '?'}ms → +${staleFrames.length ? staleFrames[staleFrames.length - 1].rel : '?'}ms`);
    rec('B1 PRE-FIX: previous account\'s real balance IS rendered after the switch',
      stale.length > 0, stale.length ? `$${A_TOTAL} visible for ${staleMs}ms after the tap` : 'not observed');
    rec('B2 PRE-FIX: the stale number persists into the new account context (>= 200ms)',
      staleMs >= 200, `${staleMs}ms`);
    rec('B3 PRE-FIX: no loading/skeleton state appeared before the new data',
      loadingSamples.length === 0, `${loadingSamples.length} loading samples`);
    rec('B4 PRE-FIX: the flash happened BEFORE B\'s data arrived',
      !!firstStale && !!firstFresh && firstStale.rel < firstFresh.rel,
      `stale@+${firstStale ? firstStale.rel : '?'}ms fresh@+${firstFresh ? firstFresh.rel : '?'}ms`);
  } else {
    rec('F1 FIXED: previous account\'s real balance is NEVER shown after the switch',
      stale.length === 0, stale.length ? `$${A_TOTAL} leaked for ${staleMs}ms (from +${firstStale.rel}ms)` : 'zero stale DOM samples');
    rec('F1b FIXED: no rendered FRAME ever shows the previous account\'s number',
      staleFrames.length === 0, staleFrames.length ? `${staleFrames.length} frames over ${staleFrameMs}ms` : `0 of ${rafSamples.length} frames`);
    rec('F2 FIXED: the new account\'s real balance DOES arrive',
      !!firstFresh, firstFresh ? `+${firstFresh.rel}ms` : 'never');
    rec('F3 FIXED: a loading/skeleton state fills the gap (no number shown)',
      loadingSamples.length > 0, `${loadingSamples.length} samples, from +${loadingSamples[0] ? loadingSamples[0].rel : '?'}ms`);
    rec('F4 FIXED: loading state appears BEFORE the new real data',
      !!loadingSamples[0] && !!firstFresh && loadingSamples[0].rel < firstFresh.rel,
      `loading@+${loadingSamples[0] ? loadingSamples[0].rel : '?'}ms fresh@+${firstFresh ? firstFresh.rel : '?'}ms`);
    rec('F5 FIXED: the switch never paints account A\'s number (0ms window)',
      staleFrames.length === 0, `${staleFrameMs}ms of painted stale frames`);
  }

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed  (mode=${MODE}, entry=${ENTRY})`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log(`screenshots → ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
