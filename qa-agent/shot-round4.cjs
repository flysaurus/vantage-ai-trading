// ─────────────────────────────────────────────────────────────
// Insights ROUND 3 — Em's corrected sizing (SUPERSEDES the earlier sizing) +
//   A. "YOUR PORTFOLIO" balance block must be a real CARD on the canvas
//      (white fill, 0.5px #E7EAE4 hairline, rounded, real padding) wrapping
//      label + serif balance + Today/Total + "See Holdings →" — not bare text.
//   B. Concentration card right column: ring CENTRED in the fixed ~108px rail,
//      legend DIRECTLY beneath it, tight gaps, legend right edge aligned to the
//      ring's right edge (was bleeding to the rail edge with marginLeft:auto).
//   C. Ask Rufus floating bar must not permanently cover content — reserved
//      space below the last card must exceed the bar's footprint.
//   D. Deck dot indicator still renders below the hero deck.
//
// Everything is measured from the live DOM (no assumptions), with the REAL
// account position fixture so the donut/legend numbers are honest.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/round4';
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

/* ── real fixture-derived expectations ── */
const rows = pos.alpaca;
const totalMV = rows.reduce((s, r) => s + (r.market_value || 0), 0);
const ranked = [...rows].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
const top1 = ranked[0], top2 = ranked[1];
const shareOf = (r) => ((r.market_value || 0) / totalMV) * 100;
const expStat = `${Math.round(shareOf(top1) * 10) / 10}%`;
const expRows = [`${top1.symbol} ${Math.round(shareOf(top1))}%`, `${top2.symbol} ${Math.round(shareOf(top2))}%`,
  `Other ${Math.round(100 - shareOf(top1) - shareOf(top2))}%`];
const alpacaCash = 25000;

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
const CONC = item('mock-conc-single', 'concentration_single', 'Concentration risk',
  `${top1.symbol} alone is ${expStat} of your portfolio. That single position outweighs everything else you own.`,
  'warn', '⚖️', 'REBALANCE', { pct: Number(shareOf(top1).toFixed(1)), symbol: top1.symbol, symbols: [top1.symbol] });
const EVENT_REVIEW = item('mock-event-review', 'event_impact', 'Earnings this week',
  'NVDA reports Thursday. Your position is large enough that the move will show up in your balance.',
  'accent', '📅', 'REVIEW_POSITION:NVDA', { severity: 'review', symbol: 'NVDA' });
const IDLE = item('mock-idle', 'idle_cash', 'Idle cash',
  "You're holding about $25,000 in cash that isn't working for you.", 'info', '💰', 'INVEST_CASH:25000', { amount: 25000 });
const NOTICED = [CONC, EVENT_REVIEW, IDLE];
const DAILY = { content: 'MARKET: Tech leads the tape.\nPORTFOLIO: Financials are carrying the book.\nWATCH: XLF near a 52-week high.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

async function setup(browser, { theme = 'light', viewport, dsf = 1 } = {}) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 430, height: 932 }, deviceScaleFactor: dsf });
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
  return { ctx, page };
}

async function gotoInsights(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
    const ok = await page.locator('[data-testid="hero-deck"]').first()
      .waitFor({ timeout: attempt === 0 ? 60000 : 90000 }).then(() => true).catch(() => false);
    if (ok) { await page.waitForTimeout(2500); return true; }
    console.log(`  ⚠️  hero-deck missing (attempt ${attempt + 1}) — reloading`);
  }
  const body = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '');
  console.log('  ⚠️  giving up; body starts:', JSON.stringify(body));
  return false;
}
/** Scroll the Insights scroller so `testid` sits with its top at `offsetPx` from
 *  the scroller's top. Rect-based (offsetTop can be relative to a positioned
 *  ancestor and silently no-op). Returns nothing; caller measures after. */
async function scrollTo(page, testid, offsetPx) {
  const info = await page.evaluate(([id, off]) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return { ok: false, why: 'element missing' };
    let sc = el.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
    if (!sc) return { ok: false, why: 'no scrollable ancestor' };
    const want = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - off;
    sc.scrollTop = Math.max(0, Math.min(want, sc.scrollHeight - sc.clientHeight));
    return { ok: true, scrollTop: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight };
  }, [testid, offsetPx]);
  await page.waitForTimeout(700);
  return info;
}


/* ─────────────────────────────────────────────────────────────
   ROUND 4 evidence: no donut, bold-sans balance, skeleton loading.
   ───────────────────────────────────────────────────────────── */
(async () => {
  const browser = await chromium.launch();
  const results = [];
  const rec = (n, p, d = '') => { results.push({ n, p, d }); console.log(`${p ? '  ✅' : '  ❌'} ${n}${d ? ' — ' + d : ''}`); };

  for (const theme of ['light', 'dark']) {
    const { ctx, page } = await setup(browser, { theme, dsf: 3 });
    if (await gotoInsights(page)) {
      await scrollTo(page, 'insight-card', 120);
      const info = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="insight-card"][data-trigger-type="concentration_single"]');
        if (!c) return { found: false };
        return {
          found: true,
          donut: !!c.querySelector('[data-testid="donut-column"]'),
          legend: c.querySelectorAll('[data-testid="donut-legend-row"]').length,
          arcs: c.querySelectorAll('svg circle').length,
          stat: (c.querySelector('[data-testid="hero-stat"]') || {}).textContent || '',
          rowKids: (c.querySelector('[data-testid="concentration-top-row"]') || { children: [] }).children.length,
          cardH: Math.round(c.getBoundingClientRect().height),
          sentenceW: Math.round((c.querySelector('[data-testid="card-sentence"]') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width),
        };
      });
      rec(`concentration card present (${theme})`, info.found);
      if (info.found) {
        rec(`no donut / no legend / no arcs (${theme})`, !info.donut && info.legend === 0 && info.arcs === 0,
          `donut=${info.donut} legend=${info.legend} arcs=${info.arcs}`);
        rec(`top row = category + stat only (${theme})`, info.rowKids === 2, `kids=${info.rowKids}`);
        rec(`stat still real ("${expStat}") (${theme})`, info.stat.includes(expStat), `stat="${info.stat}"`);
        rec(`card reclaimed the ring height (${theme})`, info.cardH <= 300, `h=${info.cardH}px`);
        await page.screenshot({ path: `${OUT}/R4-${theme === 'light' ? 1 : 2}-concentration-no-donut.png` });
      }

      const f = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="balance-amount"]');
        if (!el) return null;
        const s = getComputedStyle(el);
        return { text: el.textContent, family: s.fontFamily, style: s.fontStyle, weight: s.fontWeight, size: s.fontSize };
      });
      rec(`balance number = bold sans, not italic serif (${theme})`,
        !!f && f.style !== 'italic' && Number(f.weight) >= 700 && /sans/i.test(f.family), JSON.stringify(f));
      const bal = await page.$('[data-testid="balance-card"]');
      if (bal) { await bal.scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await bal.screenshot({ path: `${OUT}/R4-${theme === 'light' ? 3 : 4}-balance-bold-sans.png` }); }
    }
    await ctx.close();
  }

  // NOTE: the pending/skeleton state is covered by qa-agent/verify-balance-loading.cjs
  // (Scenario P, 17/17) which owns the canonical screenshots; not duplicated here.

  await browser.close();
  const failed = results.filter((r) => !r.p);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
