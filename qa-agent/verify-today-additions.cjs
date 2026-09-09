// Verify the ADDITIVE Today-tab features (masthead, accent rule, explainability
// chip, radial glow, one-time streaming reveal). Route-mocked, nothing written
// to prod. Complements verify-today.cjs (which covers the base 9-fix spec).
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

function base64url(str) { return Buffer.from(str, 'utf8').toString('base64url'); }
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

function rawPositions(rows) {
  return rows.map((r) => {
    const qty = r.qty || 0;
    const costBasis = qty * (r.avg_cost || 0);
    const marketValue = r.market_value || 0;
    const price = r.current_price || (qty > 0 ? marketValue / qty : r.avg_cost || 0);
    const openPnl = r.unrealized_pnl != null ? r.unrealized_pnl : (marketValue - costBasis);
    return { symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: qty, costBasis, price, marketValue, dayChange: 0, dayChangePct: 0, openPnl, currency: 'USD' };
  });
}
function accountResponse(rows, cash, buyingPower) {
  const positions = rawPositions(rows);
  const mv = positions.reduce((s, p) => s + p.marketValue, 0);
  const pnl = positions.reduce((s, p) => s + p.openPnl, 0);
  const cost = positions.reduce((s, p) => s + p.costBasis, 0);
  return { totalValue: mv + cash, cash, buyingPower, invested: mv, marketValue: mv, dayChange: 0, dayChangePct: 0, totalPnl: pnl, totalPnlPct: cost > 0 ? (pnl / cost) * 100 : 0, currency: 'USD', accountStatus: 'open', lastSynced: new Date().toISOString(), holdingsUnavailable: false, positions };
}
const alpacaCash = 25000;
const alpMV = rawPositions(pos.alpaca).reduce((s, p) => s + p.marketValue, 0);
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: alpMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];

// Same lead trigger as verify-today.cjs. triggerKey drives the "seen" logic.
const rebalanceAlpaca = {
  id: 'mock-rebal-alpaca', triggerKey: 'concentration_top3:test', triggerType: 'concentration_top3',
  title: 'Top 3 are 65% of you',
  body: 'Your top 3 holdings (XLF, XLP, XLV) make up 65% of your portfolio — heavy concentration risk.',
  followUp: '', variant: 'warn', icon: '⚖️', meta: { pct: 65, symbols: ['XLF', 'XLP', 'XLV'], action: 'REBALANCE' },
  action: 'REBALANCE', createdAt: new Date().toISOString(), dismissedUntil: null,
};
const FULL_SENTENCE = rebalanceAlpaca.body;

function routePath(page, pathname, handler) {
  return page.route((url) => new URL(url).pathname === pathname, handler);
}

async function setupContext(browser, meta, noticed, viewport = { width: 1280, height: 1600 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  // NOTE: we deliberately do NOT pre-seed `vantage:seen-lead-triggers` here —
  // the fresh-context scenario is exactly the "first view" that should stream.
  await ctx.addInitScript(([lsKey, lsVal, acctKey, acctId]) => {
    try {
      localStorage.setItem(lsKey, lsVal);
      localStorage.setItem(acctKey, acctId);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, ['vantage-auth-token', localSession, 'vantage:activeAccount', `snaptrade:${ALPACA}`]);
  const page = await ctx.newPage();
  await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
  await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
    connected: true, brokerId: 'snaptrade', underlying_broker: meta.brokerageSlug, connectionId: meta.connectionId,
    accountPreview: { id: meta.connectionId, provider: meta.brokerageSlug, name: meta.name },
    environment: meta.environment, trading_enabled: meta.tradingEnabled, holdings_available: true,
  }}));
  await routePath(page, '/api/broker/snaptrade/account', (r) => r.fulfill({ json: meta.accountJson }));
  await routePath(page, '/api/broker/snaptrade/positions', (r) => r.fulfill({ json: meta.accountJson.positions }));
  await routePath(page, '/api/ai/noticed', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { items: noticed ? [noticed] : [] } });
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: 'MARKET: S&P 500 opened higher.', marketSummary: {}, generatedAt: new Date().toISOString(), cached: true } }));
  await routePath(page, '/api/notifications/unread', (r) => r.fulfill({ json: { count: 12 } }));
  await routePath(page, '/api/notifications/list', (r) => r.fulfill({ json: { notifications: [] } }));
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/auth/me', (r) => r.fulfill({ json: { user: {
    id: 'test-user', email: 'test@test.com', first_name: 'Test', last_name: 'User',
    investor_style: 'buffett', investor_style_onboarded: true, risk_tolerance: 'Moderate',
    demo_start_at: new Date().toISOString(), connection_type: null, connection_status: null,
    investorStyle: 'buffett', investorStyleOnboarded: true, riskTolerance: 'Moderate',
  } } }));
  await routePath(page, '/api/portfolio/chart', (r) => r.fulfill({ json: { points: [
    { timestamp: Date.now() - 600000, value: 99000 }, { timestamp: Date.now() - 300000, value: 101000 },
    { timestamp: Date.now(), value: 104000 },
  ] } }));
  return { ctx, page };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
async function waitForText(page, text, timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (body.includes(text)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
  const meta = { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson };
  const { ctx, page } = await setupContext(browser, meta, rebalanceAlpaca);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitForText(page, 'YOUR PORTFOLIO');

  // ── 1. Masthead: "Vantage" wordmark + orb + #5FD8DE accent rule ──
  await page.waitForSelector('[data-testid="masthead-wordmark"]', { timeout: 15000 }).catch(() => {});
  const wordmark = (await page.locator('[data-testid="masthead-wordmark"]').innerText().catch(() => '')).trim();
  check('masthead wordmark reads "Vantage"', wordmark === 'Vantage', `got="${wordmark}"`);
  const headerText = await page.locator('[data-testid="today-header"]').innerText().catch(() => '');
  check('masthead does NOT use "Rufus" as brand', !headerText.includes('Rufus'));
  // accent rule: inspect the computed border-top of the rule div (2nd child rule)
  const ruleInfo = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="today-header"]');
    if (!h) return null;
    const divs = Array.from(h.children);
    // masthead row = divs[0]; accent rule = divs[1]; account row = divs[2]; hairline = divs[3]
    const rule = divs[1];
    if (!rule) return null;
    const cs = getComputedStyle(rule);
    return { width: cs.borderTopWidth, color: cs.borderTopColor };
  });
  check('masthead has #5FD8DE 2px accent rule', ruleInfo && ruleInfo.width === '2px' && /95,216,222|149, 216, 222|rgb\(95, 216, 222\)/i.test(ruleInfo.color), JSON.stringify(ruleInfo));
  // orb icon (radial gradient circle) present
  const orbBg = await page.evaluate(() => {
    const h = document.querySelector('[data-testid="today-header"]');
    const spans = h ? Array.from(h.querySelectorAll('span')) : [];
    for (const s of spans) {
      const cs = getComputedStyle(s);
      if (cs.borderRadius === '50%' && cs.backgroundImage.includes('radial-gradient')) return cs.backgroundImage;
    }
    return null;
  });
  check('masthead orb icon (radial gradient) present', !!orbBg, orbBg ? orbBg.slice(0, 80) : 'none');

  // ── 2. Streaming reveal (first view must stream) ──
  await page.waitForSelector('[data-testid="lead-sentence"]', { timeout: 20000 });
  let sawStreaming = false;
  let sawPartial = false;
  let partialLen = 0;
  const pollStart = Date.now();
  while (Date.now() - pollStart < 6000) {
    const streaming = (await page.getAttribute('[data-testid="lead-sentence"]', 'data-streaming').catch(() => '')) || '';
    const txt = (await page.locator('[data-testid="lead-sentence"]').innerText().catch(() => '')).trim();
    if (streaming === 'true') sawStreaming = true;
    if (streaming === 'true' && txt.length > 0 && txt.length < FULL_SENTENCE.length) { sawPartial = true; partialLen = txt.length; }
    if (streaming === 'false' && txt.includes('heavy concentration risk')) break;
    await page.waitForTimeout(40);
  }
  const finalTxt = (await page.locator('[data-testid="lead-sentence"]').innerText().catch(() => '')).trim();
  check('streaming: sentence typed in (data-streaming=true observed)', sawStreaming);
  check('streaming: partial sentence observed mid-type', sawPartial, `partialLen=${partialLen}/${FULL_SENTENCE.length}`);
  check('streaming: completed to full sentence', finalTxt.includes('heavy concentration risk'));
  // stat renders instantly (not streamed) — it's a separate element, always full
  const statTxt = (await page.locator('[data-testid="lead-stat"]').innerText().catch(() => '')).trim();
  check('stat number renders instantly ("65%")', statTxt === '65%', `got="${statTxt}"`);

  // ── 3. Explainability chip (data-derived) ──
  await waitForText(page, 'positions concentrated');
  const chip = (await page.locator('[data-testid="lead-explainability"]').innerText().catch(() => '')).trim();
  const expectedChip = '3 of 26 positions concentrated';
  check('explainability chip is data-derived', chip === expectedChip, `got="${chip}"`);

  // ── 4. Radial glow behind hero stat ──
  const glowCount = await page.locator('[data-testid="lead-stat-glow"]').count();
  check('radial glow element present behind stat', glowCount === 1, `count=${glowCount}`);
  const glowStyle = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="lead-stat-glow"]');
    if (!g) return null;
    const cs = getComputedStyle(g);
    return { bg: cs.backgroundImage, blur: cs.filter, opacity: cs.opacity };
  });
  check('glow uses radial-gradient (subtle)', !!glowStyle && glowStyle.bg.includes('radial-gradient'), glowStyle ? glowStyle.bg.slice(0, 60) : 'none');

  // ── 5. Screenshots (masthead+rule, explainability chip, glow) ──
  await page.locator('.content-area').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/20-today-masthead.png`, fullPage: false });

  // chip + glow: clip the lead-story region
  const leadBox = await page.locator('[data-testid="lead-stat"]').boundingBox();
  if (leadBox) {
    await page.screenshot({
      path: `${OUT}/21-today-chip-glow.png`,
      clip: { x: 0, y: Math.max(0, leadBox.y - 120), width: 1280, height: Math.min(420, 1600 - Math.max(0, leadBox.y - 120)) },
    });
  }

  // ── 6. Reopen test: second view renders instantly (no replay) ──
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-testid="lead-sentence"]', { timeout: 25000 });
  const streamingAfterReload = (await page.getAttribute('[data-testid="lead-sentence"]', 'data-streaming').catch(() => '')) || '';
  const txtAfterReload = (await page.locator('[data-testid="lead-sentence"]').innerText().catch(() => '')).trim();
  await page.waitForTimeout(350);
  const streamingAfterReload2 = (await page.getAttribute('[data-testid="lead-sentence"]', 'data-streaming').catch(() => '')) || '';
  check('reopen: renders instantly (no replay)', streamingAfterReload === 'false' && streamingAfterReload2 === 'false' && txtAfterReload.includes('heavy concentration risk'), `s1="${streamingAfterReload}" s2="${streamingAfterReload2}" len=${txtAfterReload.length}`);
  await page.screenshot({ path: `${OUT}/22-today-reopen.png`, fullPage: false });

  await ctx.close();
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log('\n==== SUMMARY ====');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log('  -', f.name, f.detail || '')); }
  console.log('SHOTS:', fs.readdirSync(OUT).filter((f) => /^2[0-2]-today/.test(f)).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
