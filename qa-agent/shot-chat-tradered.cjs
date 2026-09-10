// Light/dark proof shots for the themed Ask Rufus chat overlay (Round 4 item 5).
// Real Supabase session, live positions mocked, no writes.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/chat-theme';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

function base64url(str) { return Buffer.from(str, 'utf8').toString('base64url'); }
const sessionObj = {
  access_token: session.access_token,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: session.expires_at,
  refresh_token: session.refresh_token,
  user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

function rawPositions(rows) {
  return rows.map((r) => ({
    symbol: r.symbol,
    name: r.name || r.symbol,
    assetType: 'stock',
    units: r.qty,
    costBasis: (r.qty || 0) * (r.avg_cost || 0),
    price: r.current_price || r.avg_cost || 0,
    marketValue: r.market_value || 0,
    dayChange: 0,
    dayChangePct: 0,
    openPnl: r.unrealized_pnl || 0,
    currency: 'USD',
  }));
}

const NOTICED = {
  success: true,
  items: [
    {
      id: 'chat-info-1', triggerType: 'event_impact', variant: 'accent', icon: '📰',
      title: 'NVDA — earnings update',
      body: 'NVIDIA reports Q3 results Thursday after the close; the options market is pricing a 6% move.',
      follow_up: 'What happened with NVDA?',
      action: null,
    },
    {
      id: 'chat-info-2', triggerType: 'position_milestone', variant: 'gain', icon: '🎯',
      title: 'XLF hit your +12% target',
      body: 'XLF crossed your target return — you said you would review the position when it did.',
      follow_up: 'What should I do with XLF now?',
      action: 'REVIEW_POSITION:XLF',
    },
  ],
};


const REPLY = [
  "Your ETF sleeve has drifted: SPY is now 41% of the portfolio after the run-up, and XLF is 30%. Here's the concrete rebalance I'd run:",
  "",
  "Trim 18 shares of SPY ($12,450) and trim 240 shares of XLF ($9,180), then add 31 shares of VTI ($9,610) with the proceeds.",
  "",
  "That brings SPY back to a 30% weight and keeps your sector exposure intact. Nothing else needs to change.",
].join('\n');

async function run() {
  const browser = await chromium.launch();
  const shots = [];
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, colorScheme: theme === 'dark' ? 'dark' : 'light' });
    const page = await ctx.newPage();
    await page.addInitScript(`
      window.localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      window.localStorage.setItem('vantage:activeAccount', '${ALPACA}');
      window.localStorage.setItem('vantage:theme', '${theme}');
      try { window.localStorage.setItem('${cookieName}', ${JSON.stringify(cookieVal)}); } catch (e) {}
      try { window.localStorage.setItem('vantage-auth-token', ${JSON.stringify(localSession)}); } catch (e) {}
      try { window.localStorage.removeItem('vantage:chat-history'); } catch (e) {}
    `);
    await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/', httpOnly: false, sameSite: 'Lax' }]);

    await page.route('**/api/accounts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, accounts: [{ id: ALPACA, broker: 'alpaca', name: 'Alpaca', isActive: true, holdingsUnavailable: false, accountStatus: 'ACTIVE', lastSynced: new Date().toISOString(), cash: 25000, equity: 101679.657, dayPnl: 512.4, dayPnlPercent: 0.51, totalPnl: 8412.2, totalPnlPercent: 8.9, buyingPower: 50000 }] }) }));
    await page.route('**/api/ai/noticed', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOTICED) }));
    await page.route('**/api/ai/daily-brief**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, brief: null }) }));
    await page.route('**/api/ai/weekly-snapshot**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, snapshot: null }) }));
    await page.route('**/api/usage/remaining**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, chat: { remaining: 40, daily: { used: 1, limit: 50 } }, noticed: { remaining: 10, daily: { used: 0, limit: 10 } }, tier: 'gold' }) }));
    await page.route('**/api/usage/stats**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, chat: { daily: { used: 1, limit: 50 } }, tier: 'gold' }) }));
    await page.route('**/api/ai/greeting', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, greeting: 'Morning. Your portfolio is up 0.5% today.' }) }));
    // SSE chat stream — a real trade recommendation in prose
    await page.route('**/api/chat', (r) => {
      const frames = REPLY.match(/[\s\S]{1,40}/g).map((t) => `data: ${JSON.stringify({ text: t })}\n\n`).join('') + 'data: [DONE]\n\n';
      r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: frames });
    });

    await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 30000 });
    await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none !important}'; document.head.appendChild(s); });
    await page.locator('[data-testid="ask-rufus-bar"]').evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await page.fill('[data-testid="chat-input"]', 'rebalance my etf sleeve');
    await page.locator('[data-testid="chat-send"]').evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="trade-rec-card"]', { timeout: 30000 });
    await page.waitForTimeout(1500);

    const p1 = `${OUT}/chat-trade-rec-${theme}.png`;
    await page.screenshot({ path: p1 });
    shots.push(p1);
    const card = page.locator('[data-testid="trade-rec-card"]');
    const p2 = `${OUT}/chat-trade-rec-${theme}-card.png`;
    await card.screenshot({ path: p2 });
    shots.push(p2);
    const labels = await card.evaluate((el) => Array.from(el.querySelectorAll('button,[data-testid]')).map((b) => (b.getAttribute('data-testid') || b.textContent || '').trim().slice(0, 24)));
    console.log(theme, 'card controls:', JSON.stringify(labels));
    console.log(theme, 'prose has trade text:', await page.locator('text=Trim 18 shares of SPY').count());
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync('/tmp/vantage-shots/chat-theme/trade-rec-shots.json', JSON.stringify(shots, null, 2));
  console.log('DONE', shots.length);
}
run().catch((e) => { console.error(e); process.exit(1); });
