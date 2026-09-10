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

async function run() {
  const browser = await chromium.launch();
  const shots = [];

  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 2,
      colorScheme: theme === 'dark' ? 'dark' : 'light',
    });
    const page = await ctx.newPage();
    await page.addInitScript(`
      window.localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      window.localStorage.setItem('vantage:activeAccount', '${ALPACA}');
      window.localStorage.setItem('vantage:theme', '${theme}');
      try { window.localStorage.setItem('${cookieName}', ${JSON.stringify(cookieVal)}); } catch (e) {}
      try { window.localStorage.setItem('vantage-auth-token', ${JSON.stringify(localSession)}); } catch (e) {}
    `);
    await ctx.addCookies([{
      name: cookieName, value: cookieVal, domain: 'localhost', path: '/', httpOnly: false, sameSite: 'Lax',
    }]);

    await page.route('**/api/accounts', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, accounts: [{ id: ALPACA, broker: 'alpaca', name: 'Alpaca', isActive: true, holdingsUnavailable: false, accountStatus: 'ACTIVE', lastSynced: new Date().toISOString(), cash: 25000, equity: 101679.657, dayPnl: 512.4, dayPnlPercent: 0.51, totalPnl: 8412.2, totalPnlPercent: 8.9, buyingPower: 50000 }] }) }));
    await page.route('**/api/ai/noticed', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NOTICED) }));
    await page.route('**/api/ai/daily-brief**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, brief: null }) }));
    await page.route('**/api/ai/weekly-snapshot**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, snapshot: null }) }));
    await page.route('**/api/portfolio/positions**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, positions: rawPositions(pos.positions || pos) }) }));

    await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 30000 });
    await page.evaluate(() => {
      const s = document.createElement('style');
      s.textContent = 'nextjs-portal{display:none !important}';
      document.head.appendChild(s);
    });

    // open chat
    await page.locator('[data-testid="ask-rufus-bar"]').evaluate((el) => el.click());
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await page.waitForTimeout(1200);

    const shot = async (name, el) => {
      const p = `${OUT}/${name}.png`;
      if (el) await el.screenshot({ path: p });
      else await page.screenshot({ path: p });
      shots.push(p);
      console.log('shot', p);
    };

    await shot(`chat-${theme}-1-empty`);
    await page.screenshot({ path: `${OUT}/chat-${theme}-3-header-zoom.png`, clip: { x: 0, y: 0, width: 430, height: 70 } });
    shots.push(`${OUT}/chat-${theme}-3-header-zoom.png`);

    // theme sanity: report the resolved tokens the chat is actually using
    const tokens = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const input = document.querySelector('[data-testid="chat-input"]');
      return {
        dataTheme: document.documentElement.getAttribute('data-theme'),
        placeholder: input ? input.getAttribute('placeholder') : null,
        chatBg: cs.getPropertyValue('--v-chat-surface').trim(),
        chatText: cs.getPropertyValue('--v-chat-text').trim(),
        chatAccent: cs.getPropertyValue('--v-chat-accent').trim(),
        inputColor: input ? getComputedStyle(input).color : null,
        inputFontFamily: input ? getComputedStyle(input).fontFamily : null,
        controls: Array.from(document.querySelectorAll('button')).slice(0, 4).map((b) => ({
          label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 12),
          color: getComputedStyle(b).color,
          background: getComputedStyle(b).backgroundColor,
        })),
        inputBarBg: (() => {
          const el = document.querySelector('.vantage-input-bar');
          return el ? getComputedStyle(el).backgroundColor : null;
        })(),
      };
    });
    console.log(JSON.stringify(tokens));

    // open the "+" Explore picker
    const explore = page.locator('button', { hasText: 'Explore' }).first();
    if (await explore.count()) {
      await explore.evaluate((el) => el.click());
      await page.waitForTimeout(700);
      await shot(`chat-${theme}-2-explore-picker`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync('/tmp/vantage-shots/chat-theme/shots.json', JSON.stringify(shots, null, 2));
  console.log('DONE', shots.length, 'shots');
}
run().catch((e) => { console.error(e); process.exit(1); });
