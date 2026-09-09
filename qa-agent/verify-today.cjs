// Verify the new "Today" home tab (replaces Portfolio as landing screen).
// Route-mocked (real Supabase session + real positions), nothing written to prod.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';

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
    return {
      symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock',
      units: qty, costBasis, price, marketValue,
      dayChange: 0, dayChangePct: 0, openPnl, currency: 'USD',
    };
  });
}
function accountResponse(rows, cash, buyingPower) {
  const positions = rawPositions(rows);
  const mv = positions.reduce((s, p) => s + p.marketValue, 0);
  const pnl = positions.reduce((s, p) => s + p.openPnl, 0);
  const cost = positions.reduce((s, p) => s + p.costBasis, 0);
  return {
    totalValue: mv + cash, cash, buyingPower, invested: mv, marketValue: mv,
    dayChange: 0, dayChangePct: 0, totalPnl: pnl, totalPnlPct: cost > 0 ? (pnl / cost) * 100 : 0, currency: 'USD',
    accountStatus: 'open', lastSynced: new Date().toISOString(),
    holdingsUnavailable: false, positions,
  };
}

const alpacaCash = 25000;
const alpMV = rawPositions(pos.alpaca).reduce((s, p) => s + p.marketValue, 0);
const fidMV = rawPositions(pos.fidelity).reduce((s, p) => s + p.marketValue, 0);
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: alpMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
  { id: `snaptrade:${FIDELITY}`, name: 'ANIKET -YOUTH ACCOUNT', broker: 'Fidelity', brokerageSlug: 'FIDELITY', isDemo: false, tradingEnabled: false, totalValue: fidMV + 1000, buyingPower: null, cash: 1000, environment: 'live', connectionId: FIDELITY },
];

function noticedItem(id, type, title, body, variant, icon, action, extraMeta = {}) {
  return { id, triggerKey: `${type}:test`, triggerType: type, title, body, followUp: '', variant, icon, meta: { action, ...extraMeta }, action, createdAt: new Date().toISOString(), dismissedUntil: null };
}

const rebalanceAlpaca = noticedItem('mock-rebal-alpaca', 'concentration_top3', 'Top 3 are 65% of you',
  "Your top 3 holdings (XLF, XLP, XLV) make up 65% of your portfolio — heavy concentration risk.",
  'warn', '⚖️', 'REBALANCE', { pct: 65, symbols: ['XLF', 'XLP', 'XLV'] });
const spyRisk = noticedItem('mock-spy-risk', 'concentration_single', 'SPY is 65% of you',
  "SPY alone is 65% of your portfolio — one bad day could really hurt.",
  'warn', '🎯', 'REVIEW_POSITION:SPY', { symbol: 'SPY', pct: 65 });

function routePath(page, pathname, handler) {
  return page.route((url) => new URL(url).pathname === pathname, handler);
}

async function setupContext(browser, activeAccountId, meta, noticed, viewport = { width: 1280, height: 1600 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsKey, lsVal, acctKey, acctId]) => {
    try {
      localStorage.setItem(lsKey, lsVal);
      localStorage.setItem(acctKey, acctId);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, ['vantage-auth-token', localSession, 'vantage:activeAccount', activeAccountId]);
  const page = await ctx.newPage();
  // (console handler removed to keep output clean)
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
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: {
    content: 'MARKET: S&P 500 opened higher this morning on cooling inflation data.\nPORTFOLIO: Your portfolio is up 0.4% today.\nEARNINGS: AAPL reports after the close.',
    marketSummary: {}, generatedAt: new Date().toISOString(), cached: true,
  }}));
  await routePath(page, '/api/notifications/unread', (r) => r.fulfill({ json: { count: 12 } }));
  await routePath(page, '/api/notifications/list', (r) => r.fulfill({ json: { notifications: [] } }));
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/auth/me', (r) => r.fulfill({ json: { user: {
    id: 'test-user', email: 'test@test.com',
    first_name: 'Test', last_name: 'User',
    investor_style: 'buffett', investor_style_onboarded: true,
    risk_tolerance: 'Moderate', demo_start_at: new Date().toISOString(),
    connection_type: null, connection_status: null,
    // camelCase aliases (useAuth reads investorStyle; route returns both)
    investorStyle: 'buffett', investorStyleOnboarded: true, riskTolerance: 'Moderate',
  } } }));
  await routePath(page, '/api/portfolio/chart', (r) => r.fulfill({ json: { points: [
    { timestamp: Date.now() - 600000, value: 99000 },
    { timestamp: Date.now() - 500000, value: 99500 },
    { timestamp: Date.now() - 400000, value: 101000 },
    { timestamp: Date.now() - 300000, value: 100500 },
    { timestamp: Date.now() - 200000, value: 102000 },
    { timestamp: Date.now() - 100000, value: 103500 },
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

// Top-3 holdings by market value (what the real-holdings donut legend should surface)
const topByMV = rawPositions(pos.alpaca).sort((a, b) => b.marketValue - a.marketValue).slice(0, 3).map((p) => p.symbol);

(async () => {
  const browser = await chromium.launch();

  // ── Scenario 1: Alpaca concentration-risk → Today tab lead story + balance + nav ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setupContext(browser, `snaptrade:${ALPACA}`, { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson }, rebalanceAlpaca);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const ready = await waitForText(page, 'YOUR PORTFOLIO');
    await waitForText(page, 'CONCENTRATION');

    // Positions + chart load asynchronously — wait for both before asserting.
    await waitForText(page, '% · ');
    await page.waitForSelector('[data-testid="portfolio-trend-chart"]', { timeout: 20000 }).catch(() => {});

    // 1. header: connection dot + account name + investor style (no wordmark/market status)
    const body = await page.locator('body').innerText();
    check('header account name present', body.includes('Alpaca Paper'));
    check('header investor style link present', body.includes('Patient Builder'));
    const headerText = await page.locator('[data-testid="today-header"]').innerText().catch(() => '');
    check('header has NO "Rufus" wordmark', !headerText.includes('Rufus'), `header="${headerText.slice(0, 40)}"`);
    check('header has NO VIEW ONLY (tradable)', !body.includes('VIEW ONLY'));

    // 2. lead story: category + numeric hero + ONE supporting sentence + CTA
    check('lead story category "CONCENTRATION"', body.includes('CONCENTRATION'));
    const leadStat = await page.locator('[data-testid="lead-stat"]').innerText().catch(() => '');
    check('lead story numeric hero = "65%" only', leadStat.trim() === '65%', `got="${leadStat.trim()}"`);
    const leadSentence = await page.locator('[data-testid="lead-sentence"]').innerText().catch(() => '');
    check('lead story one supporting sentence', leadSentence.includes('make up 65% of your portfolio'), `sentence="${leadSentence.slice(0, 40)}..."`);
    check('lead story Trade CTA', (await page.locator('button:text-is("Trade")').count()) > 0);
    check('lead story Download CTA', (await page.locator('button:text-is("Download")').count()) > 0);
    check('snooze "Remind in 5d"', body.includes('Remind in 5d'));

    // 3. donut: real-holdings legend shows top-3 by market value
    check('donut legend shows top-3 holdings', topByMV.every((s) => body.includes(s)), `top3=${topByMV.join(',')}`);

    // 4. portfolio section
    check('portfolio section label "YOUR PORTFOLIO"', body.includes('YOUR PORTFOLIO'));
    check('portfolio Today/Total', body.includes('Today') && body.includes('Total'));
    check('holdings rows show "+X% · +$Y"', body.includes('% · '));
    check('trend chart sparkline present', (await page.locator('[data-testid="portfolio-trend-chart"]').count()) > 0);
    check('"See all holdings" link', body.includes('See all holdings'));

    // 5. nav: 3 tabs only, no Watchlist / AI Advisor
    const navHas = (t) => page.locator('aside.desktop-sidebar, nav.fixed').first().innerText().then((s) => s.includes(t));
    check('nav has Today', await navHas('Today'));
    check('nav has Invest', await navHas('Invest'));
    check('nav has Settings', await navHas('Settings'));
    const navText = await page.locator('aside.desktop-sidebar, nav.fixed').first().innerText();
    check('nav does NOT have Watchlist', !navText.includes('Watchlist'));
    check('nav does NOT have AI Advisor', !navText.includes('AI Advisor'));

    // 6. Ask Rufus floating bar
    check('Ask Rufus bar present', body.includes('Ask Rufus anything'));

    // 7. bottom padding: scroll to very bottom, last element fully visible above bar
    await page.locator('.content-area').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(600);
    const seeAllBox = await page.locator('text=See all holdings').boundingBox();
    const barBox = await page.locator('button.ask-rufus-bar').boundingBox();
    check('"See all holdings" fully above Ask Rufus bar', !!seeAllBox && !!barBox && (seeAllBox.y + seeAllBox.height) <= barBox.y, `seeAllBottom=${seeAllBox ? Math.round(seeAllBox.y + seeAllBox.height) : 'n/a'}, barTop=${barBox ? Math.round(barBox.y) : 'n/a'}`);
    await page.screenshot({ path: `${OUT}/15-today-bottom.png`, fullPage: false });

    await page.locator('.content-area').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/10-today-alpaca.png`, fullPage: false });
    await ctx.close();
  }

  // ── Scenario 2: Fidelity read-only → Download-only CTA (no Trade) ──
  {
    const acctJson = accountResponse(pos.fidelity, 1000, null);
    const { ctx, page } = await setupContext(browser, `snaptrade:${FIDELITY}`, { brokerageSlug: 'FIDELITY', connectionId: FIDELITY, name: 'ANIKET -YOUTH ACCOUNT', environment: 'live', tradingEnabled: false, accountJson: acctJson }, rebalanceAlpaca);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForText(page, 'YOUR PORTFOLIO');
    await waitForText(page, 'CONCENTRATION');
    const body = await page.locator('body').innerText();
    check('read-only: Download present', (await page.locator('button:text-is("Download")').count()) > 0);
    check('read-only: NO Trade button', (await page.locator('button:text-is("Trade")').count()) === 0);
    check('read-only: account name present', body.includes('ANIKET -YOUTH ACCOUNT'));
    check('read-only: VIEW ONLY tag present', body.includes('VIEW ONLY'));
    await page.locator('body').evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/11-today-fidelity.png`, fullPage: false });
    await ctx.close();
  }

  // ── Scenario 3: no-trigger → Daily Brief fallback headline ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setupContext(browser, `snaptrade:${ALPACA}`, { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson }, null);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    const rendered = await waitForText(page, 'S&P 500 opened higher');
    await page.waitForSelector('[data-testid="portfolio-trend-chart"]', { timeout: 20000 }).catch(() => {});
    const body = await page.locator('body').innerText();
    check('fallback: Daily Brief headline', rendered && body.includes('S&P 500 opened higher'));
    check('fallback: portfolio section still present', body.includes('YOUR PORTFOLIO'));
    await page.screenshot({ path: `${OUT}/12-today-fallback.png`, fullPage: false });
    await ctx.close();
  }

  // ── Scenario 4: Ask Rufus opens full-screen chat overlay + close ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setupContext(browser, `snaptrade:${ALPACA}`, { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson }, rebalanceAlpaca);
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForText(page, 'Ask Rufus anything');
    await page.locator('button.ask-rufus-bar').click();
    const overlay = await page.locator('textarea').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    check('Ask Rufus opens chat overlay (textarea)', overlay);
    const closeBtn = await page.locator('button[aria-label="Close chat"]').count();
    check('chat overlay has close (←) button', closeBtn > 0, `close=${closeBtn}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/13-today-chat-overlay.png`, fullPage: false });
    // close it and confirm we're back on Today
    await page.locator('button[aria-label="Close chat"]').first().click().catch(() => {});
    await page.waitForTimeout(500);
    check('close returns to Today (portfolio section)', (await page.locator('body').innerText()).includes('YOUR PORTFOLIO'));
    await ctx.close();
  }

  // ── Scenario 5: mobile viewport → BottomNav 3 tabs + Ask Rufus bar ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setupContext(browser, `snaptrade:${ALPACA}`, { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson }, rebalanceAlpaca, { width: 390, height: 844 });
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitForText(page, 'YOUR PORTFOLIO');
    const navText = await page.locator('nav.fixed').first().innerText();
    check('mobile: BottomNav has Today/Invest/Settings', navText.includes('Today') && navText.includes('Invest') && navText.includes('Settings'));
    check('mobile: BottomNav no Watchlist', !navText.includes('Watchlist'));
    check('mobile: Ask Rufus bar present', (await page.locator('body').innerText()).includes('Ask Rufus anything'));
    await page.screenshot({ path: `${OUT}/14-today-mobile.png`, fullPage: false });
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log('\n==== SUMMARY ====');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log('  -', f.name, f.detail || '')); }
  console.log('SHOTS:', fs.readdirSync(OUT).filter((f) => /^1[0-5]-today/.test(f)).join(', '));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
