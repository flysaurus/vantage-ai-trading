// ─────────────────────────────────────────────────────────────
// DIAGNOSTIC — "$0.00 flash" on the Insights balance card.
//
// Question 1: is the Insights balance a NEW/duplicate fetch path, or the same
//             account data the rest of the app uses?
// Question 2: if it is the same path, is it (a) rendering while `loading` is
//             true, or (b) rendering after loading flips but before data lands?
//
// Method: fresh browser (no cache), broker endpoints delayed to simulate a
// real cold start, and a 50ms sampler installed at document-start that records
// every distinct value the balance element ever shows, with timestamps.
// Also captures the same timeline on the Holdings tab for contrast.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const DELAY_MS = Number(process.env.DELAY_MS || 2500);
const WATCH_MS = Number(process.env.WATCH_MS || 12000);
const WATCH2_MS = Number(process.env.WATCH2_MS || 14000); // Holdings contrast arm is slower (dev compile)

const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

const EXPECTED_TOTAL = ((pos.alpaca.reduce((s, r) => s + (r.market_value || 0), 0)) + 25000).toLocaleString('en-US', { maximumFractionDigits: 0 });
const totalMV = pos.alpaca.reduce((s, r) => s + (r.market_value || 0), 0);
const alpacaCash = 25000;
const raw = pos.alpaca.map((r) => ({
  symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: r.qty,
  costBasis: (r.qty || 0) * (r.avg_cost || 0), price: r.current_price || r.avg_cost || 0,
  marketValue: r.market_value || 0, dayChange: 0, dayChangePct: 0,
  openPnl: r.unrealized_pnl || 0, currency: 'USD',
}));
const acct = {
  totalValue: totalMV + alpacaCash, cash: alpacaCash, buyingPower: alpacaCash,
  invested: totalMV, marketValue: totalMV, dayChange: 0, dayChangePct: 0,
  totalPnl: raw.reduce((s, p) => s + p.openPnl, 0), totalPnlPct: 0, currency: 'USD',
  accountStatus: 'open', lastSynced: new Date().toISOString(), holdingsUnavailable: false,
  positions: raw,
};
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: totalMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];
const NOTICED = [{
  id: 'm1', triggerKey: 'concentration_single:m1', triggerType: 'concentration_single',
  title: 'Concentration risk', body: 'XLF is 30% of your portfolio.', followUp: '',
  variant: 'warn', icon: '⚖️', meta: { action: 'REBALANCE' }, action: 'REBALANCE',
  createdAt: new Date().toISOString(), dismissedUntil: null,
}];

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

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
    // ── sampler installed before any app code runs ──
    window.__samples = [];
    const t0 = performance.now();
    const snap = () => {
      const bal = document.querySelector('[data-testid="balance-amount"]');
      const card = document.querySelector('[data-testid="balance-card"]');
      const hero = document.querySelector('[data-testid="account-hero"], [data-testid="account-summary-card"]');
      window.__samples.push({
        t: Math.round(performance.now() - t0),
        bal: bal ? bal.textContent.trim() : null,
        card: !!card,
        hero: hero ? (hero.textContent || '').slice(0, 90) : null,
        body: (document.body.innerText || '').slice(0, 60).replace(/\n/g, ' | '),
        ttf: (() => { const p = performance.getEntriesByType('paint')[0]; return p ? Math.round(p.startTime) : null; })(),
      });
    };
    const iv = setInterval(snap, 50);
    setTimeout(() => clearInterval(iv), payload.watch);
  }, [localSession, { acct: `snaptrade:${ALPACA}`, watch: WATCH_MS }]);

  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/usePortfolio|PortfolioTab|Biasing|clearing stale/.test(t)) console.log(`   🖥  [console] ${t.slice(0, 160)}`);
  });
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`   🔄 main-frame navigation @ +${((Date.now() - t0) / 1000).toFixed(2)}s`); });
  const timeline = []; // server-side log of when each endpoint answered
  const log = (name) => { timeline.push({ name, at: Date.now() }); console.log(`   ⏱  ${name} served at +${((Date.now() - t0) / 1000).toFixed(2)}s`); };
  let t0 = Date.now();

  const delayed = (name, json, delay) => async (r) => {
    if (delay) await new Promise((res) => setTimeout(res, delay));
    log(name);
    await r.fulfill({ json });
  };

  /** Apply the full broker/app mock set to a page (every arm must be mocked,
   *  otherwise the arm tests the REAL backend — and measures the wrong thing). */
  async function applyMocks(p) {
  await routePath(p, '/api/accounts', delayed('GET /api/accounts', { accounts }, DELAY_MS));
  await routePath(p, '/api/broker/status', delayed('GET /api/broker/status', {
    connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER', connectionId: ALPACA,
    accountPreview: { id: ALPACA, provider: 'ALPACA-PAPER', name: 'Alpaca Paper' },
    environment: 'paper', trading_enabled: true, holdings_available: true,
  }, 300));
  await routePath(p, '/api/broker/snaptrade/account', delayed('GET /api/broker/snaptrade/account', acct, DELAY_MS));
  await routePath(p, '/api/broker/snaptrade/positions', delayed('GET /api/broker/snaptrade/positions', acct.positions, DELAY_MS));
  await routePath(p, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(p, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(p, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(p, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: 'MARKET: flat.' } }));
  await routePath(p, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: { content: 'SUMMARY: ok.' } }));
  await routePath(p, '/api/ai/noticed', (r) => r.fulfill({ json: { items: NOTICED } }));
  await routePath(p, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(p, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 } } } }));
  }

  await applyMocks(page);

  /** Poll from Node (survives reloads) and collapse to value CHANGES. */
  async function watch(target, ms) {
    const t = Date.now();
    const out = [];
    let last = null;
    while (Date.now() - t < ms) {
      let s;
      try {
        s = await target.evaluate(() => {
          const bal = document.querySelector('[data-testid="balance-amount"]');
          const card = document.querySelector('[data-testid="balance-card"]');
          const txt = document.body.innerText || '';
          const health = document.querySelector('[data-testid="portfolio-health-card"]');
          return {
            bal: bal ? bal.textContent.trim() : null,
            card: !!card,
            skel: !!document.querySelector('[data-testid="balance-skeleton"]'),
            hScore: health ? (health.getAttribute('data-health-score') || 'skel') : null,
            spinner: /Loading portfolio data/i.test(txt),
          };
        });
      } catch (e) { s = { bal: '<nav>', card: false, skel: false, hScore: null, spinner: false }; }
      const key = `${s && s.bal}|${s && s.card}|${s && s.skel}|${s && s.hScore}|${s && s.spinner}`;
      if (key !== last) { out.push({ t: Date.now() - t, ...s }); last = key; }
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  }

  // ── warm the dev server so the first real request isn't a Next.js compile ──
  console.log('\n(warming dev server…)')
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  console.log(`\n=== COLD START on Insights (broker account delayed ${DELAY_MS}ms) ===`);
  t0 = Date.now();
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'commit' });
  const changes = await watch(page, WATCH_MS);
  console.log('  distinct balance states seen (ms since nav, value, card, skeleton, health score, spinner):');
  for (const c of changes) console.log(`   +${String(c.t).padStart(6)}ms  bal=${JSON.stringify(c.bal)}  card=${c.card}  skel=${c.skel}  health=${c.hScore ?? '—'}  spinner=${c.spinner}`);
  const zeroIdx = changes.map((c, i) => (c.bal === '$0' ? i : -1)).filter((i) => i >= 0);
  if (zeroIdx.length) {
    const first = changes[zeroIdx[0]];
    const after = changes[zeroIdx[zeroIdx.length - 1] + 1];
    console.log(`  ➜ ZERO WINDOW: +${first.t}ms → ${after ? '+' + after.t + 'ms' : 'end of watch'}  = ${after ? after.t - first.t : '?'}ms of user-visible $0.00`);
  } else {
    console.log('  ➜ no $0 state observed');
  }

  // what does the fallback value actually look like? (dollars/cents split)
  const rendered = await page.locator('[data-testid="balance-card"]').innerText().catch(() => '');
  console.log('  final card text:', JSON.stringify(rendered.replace(/\n/g, ' | ')));

  if (process.env.SHOT_PENDING === '1') {
    const SHOT_DIR = '/tmp/vantage-shots/balance-flash';
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const skel = await page.evaluate(() => ({
      skel: !!document.querySelector('[data-testid="balance-skeleton"]'),
      hasDollar: /\$/.test((document.querySelector('[data-testid="balance-card"]') || {}).innerText || ''),
      cardText: ((document.querySelector('[data-testid="balance-card"]') || {}).innerText || '').replace(/\n/g, ' | '),
      healthScoreAttr: (document.querySelector('[data-testid="portfolio-health-card"]') || {}).getAttribute
        ? document.querySelector('[data-testid="portfolio-health-card"]').getAttribute('data-health-score')
        : null,
      healthPending: document.querySelector('[data-testid="portfolio-health-card"]')?.getAttribute('data-pending'),
    }));
    console.log('  PENDING-STATE PROOF:', JSON.stringify(skel));
    await page.locator('[data-testid="balance-block"]').screenshot({ path: `${SHOT_DIR}/P1-pending-balance-card.png` }).catch(() => {});
    await page.screenshot({ path: `${SHOT_DIR}/P3-pending-full.png` });
  }

  console.log('\n=== Same cold start on Holdings (contrast: what the proven path does) ===');
  const page2 = await ctx.newPage();
  await applyMocks(page2);
  page2.on('console', (m) => {
    const t = m.text();
    if (/usePortfolio|\[PortfolioTab\]/.test(t)) console.log(`   🖥  [console] ${t.slice(0, 200)}`);
  });
  t0 = Date.now();
  await page2.goto(`${BASE}/?tab=portfolio`, { waitUntil: 'commit' });
  const t2 = Date.now();
  const states = [];
  let lastKey = null;
  let firstErr = null;
  await page2.waitForTimeout(400);
  while (Date.now() - t2 < WATCH2_MS) {
    let s;
    try {
      s = await page2.evaluate((expectedStr) => {
        const txt = (document.body && document.body.innerText) || '';
        const hero = document.querySelector('[data-testid="account-hero"]');
        return {
          loading: /Loading portfolio data/i.test(txt),
          hasZero: /\$0(\.00)?\b/.test(txt),
          hasReal: txt.includes(expectedStr),
          head: (hero ? hero.innerText : txt).slice(0, 60).replace(/\n/g, ' | '),
        };
      }, EXPECTED_TOTAL);
    } catch (e) {
      if (!firstErr) { firstErr = String(e.message).split('\n')[0]; console.log('   [holdings eval error]', firstErr); }
      s = { loading: false, hasZero: false, hasReal: false, head: '<eval-error>' };
    }
    const key = `${s.loading}|${s.hasZero}|${s.hasReal}`;
    if (key !== lastKey) { states.push({ t: Date.now() - t2, ...s }); lastKey = key; }
    await new Promise((r) => setTimeout(r, 50));
  }
  console.log('  distinct states on Holdings (+ms, spinner?, shows $0?, shows real?):');
  for (const h of states) console.log(`   +${String(h.t).padStart(6)}ms  spinner=${h.loading} zero=${h.hasZero} real=${h.hasReal}  “${h.head}”`);

  await browser.close();
})().catch((e) => { console.error('diag error:', e); process.exit(2); });
