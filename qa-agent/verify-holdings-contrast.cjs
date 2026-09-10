// ─────────────────────────────────────────────────────────────
// Holdings callout in the chat — legibility gate for BOTH themes.
//
// Bug: the embedded "YOUR HOLDINGS" card (components/ai/HoldingsCallout.tsx)
// rendered the dollar value in a hardcoded near-white (#e2e8f0) that only ever
// worked on the dark chat panel — on the light panel the value was invisible
// while the ticker / subtitle / percentage stayed legible.
//
// This harness renders the card for real (real Supabase session, mocked
// positions + a mocked SSE turn that carries `dataCallout`), then MEASURES
// computed contrast instead of eyeballing:
//   effective bg  = alpha-composite of the ancestor background chain
//   text color    = computed color (alpha-composited over that bg)
//   ratio         = WCAG 2.x
// It also asserts the value is as legible as the ticker/percentage on the same
// row, and that the color is theme-DRIVEN (light value color != dark value
// color, and light != the old dark literal).
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/holdings-contrast';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + base64url(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

/* Real fixture rows (same numbers as the other harnesses) + the two fields this
   card actually reads: dayChangePercent and portfolioPercent. */
/* Real fixture rows. Note the shape: /api/broker/snaptrade/* returns positions in
   the broker's internal camelCase form (units / marketValue / costBasis / price /
   dayChangePct / openPnl) which `mapPositions()` normalizes into the Position the
   card reads (qty / marketValue / dayChangePercent / portfolioPercent). Feeding
   snake_case here silently yields $0.00 rows. */
const POSITIONS = [
  { symbol: 'XLF', name: 'Financial Select Sector SPDR Fund', assetType: 'stock', units: 600, costBasis: 26460, price: 51.27, marketValue: 30764.46, dayChange: 189.4, dayChangePct: 0.62, openPnl: 4304.46, currency: 'USD' },
  { symbol: 'XLP', name: 'Consumer Staples Select Sector SPDR', assetType: 'stock', units: 250, costBasis: 19600, price: 81.08, marketValue: 20268.98, dayChange: -69.1, dayChangePct: -0.34, openPnl: 668.98, currency: 'USD' },
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', assetType: 'stock', units: 40, costBasis: 19928, price: 601.44, marketValue: 24057.6, dayChange: 98.6, dayChangePct: 0.41, openPnl: 4129.6, currency: 'USD' },
];
const CASH = 25000;
const totalMV = POSITIONS.reduce((s, p) => s + p.market_value, 0);

const accounts = [{
  id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER',
  isDemo: false, tradingEnabled: true, totalValue: totalMV + CASH, buyingPower: CASH, cash: CASH,
  environment: 'paper', connectionId: ALPACA,
}];
const accountPayload = {
  totalValue: totalMV + CASH, cash: CASH, buyingPower: CASH, invested: totalMV, marketValue: totalMV,
  dayChange: 214.7, dayChangePct: 0.21, totalPnl: 9103.04, totalPnlPct: 8.95, currency: 'USD',
  accountStatus: 'open', lastSynced: new Date().toISOString(), holdingsUnavailable: false,
  positions: POSITIONS,
};

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, p: pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

/* ── contrast maths (Node side) ── */
function parseColor(s) {
  if (!s) return null;
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});
const lum = (c) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

/* Reads the effective background behind `testid` by compositing the ancestor
   chain (computed styles resolve var() substitutions, so the tokens show up as
   real rgba values). */
const READ_CONTRAST = ([testid, bgTestId]) => {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  if (!el) return { error: 'element missing' };
  const parse = (s) => {
    const m = s && s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const comp = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  // Walk up collecting translucent layers until a genuinely OPAQUE base is
  // found. A gradient stop with alpha is just another layer (the light chat
  // panel paints a translucent fill gradient), so never treat it as the base —
  // doing that was the first version of this harness and it reported a bogus
  // 1:1 ratio.
  const layers = [];
  let base = null;
  let node = el;
  while (node && node !== document.documentElement) {
    const cs = getComputedStyle(node);
    const bg = parse(cs.backgroundColor);
    const bgi = cs.backgroundImage;
    let opaque = false;
    if (bg && bg.a > 0.995) { base = bg; opaque = true; }
    else if (bg && bg.a > 0) layers.push(bg);
    if (!opaque && bgi && bgi !== 'none') {
      const stops = (bgi.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
      const op = stops.find((x) => x.a > 0.995);
      if (op) { base = op; opaque = true; }
      else if (stops[0]) layers.push(stops[0]);
    }
    if (opaque) break;
    node = node.parentElement;
  }
  if (!base) base = { r: 255, g: 255, b: 255, a: 1 };
  let eff = base;
  for (let i = layers.length - 1; i >= 0; i--) eff = comp(layers[i], eff);

  const read = (id) => {
    const t = document.querySelector(`[data-testid="${id}"]`) || (id === 'SELF' ? el : null);
    if (!t) return null;
    const cs = getComputedStyle(t);
    const fg = parse(cs.color);
    const effFg = fg.a < 1 ? comp(fg, eff) : fg;
    return { color: cs.color, font: `${cs.fontWeight} ${cs.fontSize}`, eff: effFg };
  };
  const bgEl = document.querySelector(`[data-testid="${bgTestId}"]`);
  const cardBg = bgEl ? getComputedStyle(bgEl).backgroundColor : null;
  const cardBgEff = (() => {
    const c = parse(cardBg);
    if (!c) return eff;
    return c.a < 1 ? comp(c, eff) : c;
  })();

  const self = read('SELF');
  return {
    ok: true,
    cardBg, cardBgEff,
    effBg: eff,
    value: { color: getComputedStyle(el).color, eff: self ? self.eff : null, font: self ? self.font : null },
  };
};

async function setup(browser, theme) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 }, deviceScaleFactor: 3,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/', httpOnly: false, sameSite: 'Lax' }]);
  await ctx.addInitScript(([lsv, acct, th, cookie]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem(cookie, '1');
      localStorage.setItem('vantage:activeAccount', acct);
      localStorage.setItem('vantage:theme', th);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      localStorage.removeItem('vantage:chat-history');
      localStorage.removeItem('vantage:data-callout');
    } catch (e) {}
  }, [localSession, `snaptrade:${ALPACA}`, theme, cookieName]);
  return { ctx, page: await ctx.newPage() };
}

async function applyMocks(page) {
  await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
  await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
    connected: true, brokerId: 'snaptrade', underlying_broker: 'ALPACA-PAPER', connectionId: ALPACA,
    accountPreview: { id: ALPACA, provider: 'ALPACA-PAPER', name: 'Alpaca Paper' },
    environment: 'paper', trading_enabled: true, holdings_available: true,
  }}));
  await routePath(page, '/api/broker/snaptrade/account', (r) => r.fulfill({ json: accountPayload }));
  await routePath(page, '/api/broker/snaptrade/positions', (r) => r.fulfill({ json: accountPayload.positions }));
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/ai/noticed', (r) => r.fulfill({ json: { items: [] } }));
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: null } }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: { content: null } }));
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40, tier: 'gold' } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'gold', chat: { daily: { used: 1, limit: 50 } } } }));
  await routePath(page, '/api/ai/greeting', (r) => r.fulfill({ json: { greeting: 'Morning.' } }));
  // SSE: prose + the holdings dataCallout tag the server would emit
  await routePath(page, '/api/chat', (r) => {
    const frames = [
      `data: ${JSON.stringify({ text: "Here's your live book:" })}\n\n`,
      `data: ${JSON.stringify({ dataCallout: { scope: 'holdings' } })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: frames });
  });
}

async function openChat(page) {
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 60000 });
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'nextjs-portal{display:none !important}';
    document.head.appendChild(s);
  });
  await page.locator('[data-testid="ask-rufus-bar"]').evaluate((el) => el.click());
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 30000 });
  await page.fill('[data-testid="chat-input"]', 'what are my holdings?');
  await page.locator('[data-testid="chat-send"]').evaluate((el) => el.click());
  await page.waitForSelector('[data-testid="holdings-callout"]', { timeout: 40000 });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch();
  const seen = {};

  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await setup(browser, theme);
    await applyMocks(page);
    await openChat(page);

    const card = page.locator('[data-testid="holdings-callout"]');
    const cardText = (await card.innerText()).replace(/\n+/g, ' | ').slice(0, 220);
    console.log(`  [${theme}] card: ${cardText}`);
    const rows = await page.locator('[data-testid^="holdings-row-"]').count();
    rec(`card renders with real positions (${theme})`, rows === POSITIONS.length, `rows=${rows}`);

    const READ = READ_CONTRAST;
    const value = await page.evaluate(READ, ['holdings-value-XLF', 'holdings-callout']);
    const sym = await page.evaluate(READ, ['holdings-row-XLF', 'holdings-callout']);
    const pct = await page.evaluate(READ, ['holdings-pct-XLF', 'holdings-callout']);

    if (process.env.DBG) console.log('RAW value', JSON.stringify(value));
    if (process.env.DBG) console.log('RAW sym', JSON.stringify(sym));
    if (process.env.DBG) console.log('RAW pct', JSON.stringify(pct));
    const lv = ratio(value.value.eff, value.effBg);
    seen[theme] = seen[theme] || {}; seen[theme].effBgObject = value.effBg;
    const ls = ratio(sym.value.eff, sym.effBg);
    const lp = ratio(pct.value.eff, pct.effBg);

    console.log(`  [${theme}] bg=${JSON.stringify(value.effBg)} value=${value.value.color} → ${lv.toFixed(2)}:1` +
      ` | ticker ${ls.toFixed(2)}:1 | pct ${lp.toFixed(2)}:1`);
    seen[theme] = { valueColor: value.value.color, cardBg: value.cardBg, lv, ls, lp };

    rec(`dollar value meets WCAG AA (>=4.5:1) on the ${theme} card`, lv >= 4.5, `${lv.toFixed(2)}:1`);
    rec(`dollar value is as legible as the ticker on the same row (${theme})`,
      lv >= ls * 0.9 - 0.15, `value ${lv.toFixed(2)} vs ticker ${ls.toFixed(2)}`);
    rec(`percentage is legible too (${theme})`, lp >= 4.5, `${lp.toFixed(2)}:1`);

    // theme-driven, not a literal that happens to work in one theme
    const isDarkCard = lum(value.effBg) < 0.2;
    const isLightCard = lum(value.effBg) > 0.7;
    rec(`card background follows the theme (${theme})`,
      theme === 'dark' ? isDarkCard : isLightCard, `bgLum=${lum(value.effBg).toFixed(3)}`);

    if (theme === 'light') {
      const lit = parseColor('rgb(226, 232, 240)'); // the old hardcoded dark-only value
      const eff = value.value.eff;
      rec('light value is NOT the old dark-only literal #e2e8f0',
        Math.abs(eff.r - lit.r) + Math.abs(eff.g - lit.g) + Math.abs(eff.b - lit.b) > 24,
        `eff=${JSON.stringify(eff)}`);
    }

    const gain = await page.evaluate(READ, ['holdings-pct-XLF', 'holdings-callout']);
    const loss = await page.evaluate(READ, ['holdings-pct-XLP', 'holdings-callout']);
    const lg = ratio(gain.value.eff, gain.effBg), ll = ratio(loss.value.eff, loss.effBg);
    console.log(`  [${theme}] gain pct ${gain.value.color} → ${lg.toFixed(2)}:1 | loss pct ${loss.value.color} → ${ll.toFixed(2)}:1`);
    rec(`gain/loss percentages use theme tokens and stay legible (${theme})`,
      lg >= 4.5 && ll >= 4.5 && gain.value.color !== loss.value.color,
      `gain=${gain.value.color} ${lg.toFixed(2)}:1 / loss=${loss.value.color} ${ll.toFixed(2)}:1`);
    seen[theme].gain = gain.value.color; seen[theme].loss = loss.value.color;

    await card.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/HC-${theme}-full.png` });
    await card.screenshot({ path: `${OUT}/HC-${theme}-card.png` });
    const row = page.locator('[data-testid="holdings-row-XLF"]');
    await row.screenshot({ path: `${OUT}/HC-${theme}-row.png` });
    await ctx.close();
  }

  rec('value color is THEME-DRIVEN (light and dark resolve to different colors)',
    seen.light.valueColor !== seen.dark.valueColor,
    `light=${seen.light.valueColor} dark=${seen.dark.valueColor}`);
  rec('no regression in dark (still >=4.5:1)', seen.dark.lv >= 4.5, `${seen.dark.lv.toFixed(2)}:1`);

  const oldLiteral = parseColor('rgb(226, 232, 240)');
  const beforeRatio = ratio(oldLiteral, seen.light.effBgObject || { r: 225.7, g: 228.2, b: 227.1 });
  console.log(`\n  CONTROL (what the bug looked like): the old hardcoded #e2e8f0 on the LIGHT card = ${beforeRatio.toFixed(2)}:1`);
  results.push({ name: 'control: old hardcoded #e2e8f0 on the light card is effectively invisible (<1.5:1)', p: beforeRatio < 1.5, detail: `${beforeRatio.toFixed(2)}:1` });

  await browser.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks: results, seen }, null, 2));
  const failed = results.filter((r) => !r.p);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
