// ─────────────────────────────────────────────────────────────
// PART 1b — inline threshold-crossing badge on the position row.
//
// Contract under test (Em's PART 1, item b):
//   • target-return / target-loss crossings are NOT a list item anywhere
//   • they render as a small PILL immediately next to the ticker on the
//     affected position's row, on the Holdings full list
//   • "▼ crossed -20%" (loss, coral/red) / "▲ crossed +250%" (gain, green)
//   • ONLY rows with an active crossing get a badge — most rows get none
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/threshold-badge';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

/* ── fixture ── */
const rows = pos.alpaca;
const totalMV = rows.reduce((s, r) => s + (r.market_value || 0), 0);
const ranked = [...rows].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
const top1 = ranked[0];
const alpacaCash = 25000;

// Two real symbols with active crossings + one clearly without, so "only
// crossed rows get a badge" is a real assertion, not a happy path.
const GAIN_SYM = top1.symbol;
const LOSS_SYM = ranked[1].symbol;
const PLAIN_SYM = ranked[2].symbol;

function rawPositions(list) {
  return list.map((r) => ({
    symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: r.qty,
    costBasis: (r.qty || 0) * (r.avg_cost || 0), price: r.current_price || r.avg_cost || 0,
    marketValue: r.market_value || 0, dayChange: 0, dayChangePct: 0,
    openPnl: r.unrealized_pnl || 0, currency: 'USD',
  }));
}
function accountResponse(list, cash) {
  const positions = rawPositions(list);
  const mv = positions.reduce((s, p) => s + p.marketValue, 0);
  const pnl = positions.reduce((s, p) => s + p.openPnl, 0);
  return {
    totalValue: mv + cash, cash, buyingPower: cash, invested: mv, marketValue: mv,
    dayChange: 0, dayChangePct: 0, totalPnl: pnl, totalPnlPct: 0, currency: 'USD',
    accountStatus: 'open', lastSynced: new Date().toISOString(),
    holdingsUnavailable: false, positions,
  };
}
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: totalMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];

const item = (id, type, title, body, variant, icon, action, extra = {}) => ({
  id, triggerKey: `${type}:${id}`, triggerType: type, title, body, followUp: '',
  variant, icon, meta: { action, ...extra }, action,
  createdAt: new Date(Date.now() - 3600e3).toISOString(), dismissedUntil: null,
});

// REAL engine shape: position_milestone meta = { symbol, threshold,
// currentPnlPct, marketValue, action }.
const MILESTONE_GAIN = item('mock-ms-gain', 'position_milestone', `${GAIN_SYM} +250%`,
  `${GAIN_SYM} crossed +250% (now +261%) — worth a look.`, 'gain', '📈',
  `REVIEW_POSITION:${GAIN_SYM}`, { symbol: GAIN_SYM, threshold: 250, currentPnlPct: 261.4, marketValue: top1.market_value });

const MILESTONE_LOSS = item('mock-ms-loss', 'position_milestone', `${LOSS_SYM} -20%`,
  'BX: crossed -20% total return threshold (currently at -23.9%). Position value: $129.07.',
  'warn', '📉', `REVIEW_POSITION:${LOSS_SYM}`, { symbol: LOSS_SYM, threshold: -20, currentPnlPct: -23.9, marketValue: 129.07 });

const NOTICED = [MILESTONE_GAIN, MILESTONE_LOSS];
const DAILY = { content: 'MARKET: Tech leads the tape.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

async function setup(browser, { theme = 'light' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, acct, th]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      localStorage.setItem('vantage:theme', th);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, `snaptrade:${ALPACA}`, theme]);

  const page = await ctx.newPage();
  const acctJson = accountResponse(pos.alpaca, alpacaCash);
  await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
  await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
    connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER', connectionId: ALPACA,
    accountPreview: { id: ALPACA, provider: 'ALPACA-PAPER', name: 'Alpaca Paper' },
    environment: 'paper', trading_enabled: true, holdings_available: true,
  }}));
  await routePath(page, '/api/broker/snaptrade/account', (r) => r.fulfill({ json: acctJson }));
  await routePath(page, '/api/broker/snaptrade/positions', (r) => r.fulfill({ json: acctJson.positions }));
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: DAILY }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: WEEKLY }));
  await routePath(page, '/api/ai/noticed', (r) => (r.request().method() === 'GET'
    ? r.fulfill({ json: { items: NOTICED } }) : r.fulfill({ json: { ok: true } })));
  await routePath(page, '/api/ai/noticed/dismiss', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
  await routePath(page, '/api/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"text":"mocked"}\n\ndata: [DONE]\n\n' }));

  await page.goto(`${BASE}/?tab=portfolio`, { waitUntil: 'domcontentloaded' });
  // Wait for a real position row (the badge is on the row, so the row must exist).
  await page.waitForSelector(`[data-testid="threshold-badge-${GAIN_SYM}"]`, { timeout: 45000 });
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none !important}'; document.head.appendChild(s); });
  await page.waitForTimeout(800);
  return { ctx, page };
}

const lum = (c) => {
  const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

(async () => {
  const browser = await chromium.launch();

  for (const theme of ['light', 'dark']) {
    console.log(`\n── ${theme.toUpperCase()} ──`);
    const { ctx, page } = await setup(browser, { theme });

    const badges = await page.$$eval('[data-testid^="threshold-badge-"]', (n) => n.map((e) => {
      const cs = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      const row = e.closest('.position-card-v3, [data-testid^="position-"]');
      const symbolEl = row ? row.querySelector('span[style*="font-weight: 700"]') : null;
      const sr = symbolEl ? symbolEl.getBoundingClientRect() : null;
      return {
        testid: e.getAttribute('data-testid'),
        symbol: e.getAttribute('data-symbol'),
        tone: e.getAttribute('data-tone'),
        threshold: e.getAttribute('data-threshold'),
        text: e.textContent.trim(),
        color: cs.color, bg: cs.backgroundColor,
        fontSize: cs.fontSize, radius: cs.borderTopLeftRadius, weight: cs.fontWeight,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        symbolRect: sr ? { top: sr.top, left: sr.left, right: sr.right, bottom: sr.bottom } : null,
      };
    }));

    console.log(`  badges found: ${badges.length}`, JSON.stringify(badges.map((b) => `${b.symbol} ${b.text}`)));

    rec(`${theme} T1 Exactly one badge per crossed symbol (2)`, badges.length === 2, `n=${badges.length}`);

    const gain = badges.find((b) => b.symbol === GAIN_SYM);
    const loss = badges.find((b) => b.symbol === LOSS_SYM);
    rec(`${theme} T2 Gain badge text is "▲ crossed +250%"`, gain?.text === '▲ crossed +250%', gain?.text);
    rec(`${theme} T3 Loss badge text is "▼ crossed -20%"`, loss?.text === '▼ crossed -20%', loss?.text);
    rec(`${theme} T4 Gain tone + green`, gain?.tone === 'gain', `${gain?.tone} ${gain?.color}`);
    rec(`${theme} T5 Loss tone + coral/red`, loss?.tone === 'loss', `${loss?.tone} ${loss?.color}`);
    rec(`${theme} T6 Gain/Loss colors differ`, gain && loss && gain.color !== loss.color, `${gain?.color} vs ${loss?.color}`);

    // Pill geometry — small pill, not a link/button.
    rec(`${theme} T7 Renders as a small pill (radius >= 8, fontSize <= 11)`,
      badges.every((b) => parseFloat(b.radius) >= 8 && parseFloat(b.fontSize) <= 11),
      `radius=${badges[0]?.radius} fontSize=${badges[0]?.fontSize}`);
    rec(`${theme} T8 Bold weight`, badges.every((b) => parseInt(b.weight) >= 600), badges[0]?.weight);

    // Placement — on the SAME row, immediately to the right of the ticker.
    const placed = badges.every((b) => {
      if (!b.symbolRect) return false;
      const vOverlap = b.rect.top < b.symbolRect.bottom && b.rect.top + b.rect.height > b.symbolRect.top;
      const toTheRight = b.rect.left >= b.symbolRect.right - 1;
      const closeBy = b.rect.left - b.symbolRect.right < 60;
      return vOverlap && toTheRight && closeBy;
    });
    rec(`${theme} T9 Pill sits next to the ticker on the same row`, placed, JSON.stringify(badges.map((b) => ({ s: b.symbol, gap: b.symbolRect ? +(b.rect.left - b.symbolRect.right).toFixed(1) : null }))));

    // Only crossed rows carry a badge.
    const rowsTotal = await page.$$eval('.position-card-v3', (n) => n.length);
    rec(`${theme} T10 Most rows have NO badge (only crossed rows)`, rowsTotal > badges.length,
      `rows=${rowsTotal} badges=${badges.length}`);
    const plainHas = await page.$(`[data-testid="threshold-badge-${PLAIN_SYM}"]`);
    rec(`${theme} T11 Uncrossed symbol (${PLAIN_SYM}) has NO badge`, !plainHas);

    // Contrast of the pill text against its own translucent background over the
    // always-dark card — composite the pill bg over the card surface first.
    const cardBg = await page.$eval('.position-card-v3', (e) => getComputedStyle(e).backgroundColor);
    const composite = (fg, bg, alpha) => {
      const f = fg.match(/[\d.]+/g).map(Number);
      const b = bg.match(/[\d.]+/g).map(Number);
      const a = alpha ?? (f.length > 3 ? f[3] : 1);
      const out = [0, 1, 2].map((i) => Math.round(f[i] * a + b[i] * (1 - a)));
      return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
    };
    const pillBgOverCard = composite(badges[0].bg, cardBg);
    const cGain = gain ? contrast(gain.color, pillBgOverCard) : 0;
    const cLoss = loss ? contrast(loss.color, pillBgOverCard) : 0;
    rec(`${theme} T12 Badge text contrast >= 4.5:1`, cGain >= 4.5 && cLoss >= 4.5,
      `gain=${cGain.toFixed(2)}:1 loss=${cLoss.toFixed(2)}:1 (pillBg=${pillBgOverCard} card=${cardBg})`);

    // The raw deterministic context must never render on the row either.
    const rowText = await page.$eval('.position-card-v3', (e) => e.innerText);
    rec(`${theme} T13 No raw context string on the row`,
      !/total return threshold|position value:\s*\$/i.test(rowText), rowText.replace(/\n/g, ' | ').slice(0, 120));

    fs.writeFileSync(`${OUT}/badges-${theme}.json`, JSON.stringify(badges, null, 2));
    await page.screenshot({ path: `${OUT}/holdings-${theme}.png` });
    if (gain) {
      const el = await page.$(`[data-testid="threshold-badge-${GAIN_SYM}"]`);
      const card = await el.evaluateHandle((e) => e.closest('.position-card-v3'));
      await card.asElement().screenshot({ path: `${OUT}/row-gain-${theme}.png` });
    }
    if (loss) {
      const el = await page.$(`[data-testid="threshold-badge-${LOSS_SYM}"]`);
      const card = await el.evaluateHandle((e) => e.closest('.position-card-v3'));
      await card.asElement().screenshot({ path: `${OUT}/row-loss-${theme}.png` });
    }

    await ctx.close();
  }

  /* ── C. No crossings at all → no badges anywhere ── */
  {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(([lsv, acct, th]) => {
      try {
        localStorage.setItem('vantage-auth-token', lsv);
        localStorage.setItem('vantage:activeAccount', acct);
        localStorage.setItem('vantage:theme', th);
        localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      } catch (e) {}
    }, [localSession, `snaptrade:${ALPACA}`, 'light']);
    const page = await ctx.newPage();
    const acctJson = accountResponse(pos.alpaca, alpacaCash);
    await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
    await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
      connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER', connectionId: ALPACA,
      accountPreview: { id: ALPACA, provider: 'ALPACA-PAPER', name: 'Alpaca Paper' },
      environment: 'paper', trading_enabled: true, holdings_available: true } }));
    await routePath(page, '/api/broker/snaptrade/account', (r) => r.fulfill({ json: acctJson }));
    await routePath(page, '/api/broker/snaptrade/positions', (r) => r.fulfill({ json: acctJson.positions }));
    await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
    await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
    await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
    await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: DAILY }));
    await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: WEEKLY }));
    await routePath(page, '/api/ai/noticed', (r) => (r.request().method() === 'GET'
      ? r.fulfill({ json: { items: [] } }) : r.fulfill({ json: { ok: true } })));
    await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
    await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
    await page.goto(`${BASE}/?tab=portfolio`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.position-card-v3', { timeout: 45000 });
    await page.waitForTimeout(800);
    const n = await page.$$eval('[data-testid^="threshold-badge-"]', (x) => x.length);
    rec('C1 No crossings → no badges anywhere', n === 0, `badges=${n}`);
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
