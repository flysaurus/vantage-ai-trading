// ─────────────────────────────────────────────────────────────
// Insights review pass — Em's four items (Sep 10):
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
const OUT = '/tmp/vantage-shots/insights-review';
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
const expRows = [`${top1.symbol} ${Math.round(shareOf(top1))}%`, `Other ${Math.round(100 - shareOf(top1))}%`];
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

/** Scroll so that the deck's BOTTOM edge sits `gapPx` above the floating bar's
 *  top — the unambiguous overlap shot (deck bottom + bar in one frame, nothing
 *  in between). Returns the measured clearance. */
async function scrollDeckBottomAboveBar(page, gapPx = 24) {
  const info = await page.evaluate((gap) => {
    const deck = document.querySelector('[data-testid="hero-deck"]');
    const bar = document.querySelector('[data-testid="ask-rufus-bar"]') || document.querySelector('.ask-rufus-bar');
    if (!deck || !bar) return { ok: false };
    let sc = deck.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight + 4) sc = sc.parentElement;
    if (!sc) return { ok: false };
    const barTop = bar.getBoundingClientRect().top;
    const delta = deck.getBoundingClientRect().bottom - (barTop - gap);
    const want = sc.scrollTop + delta;
    sc.scrollTop = Math.max(0, Math.min(want, sc.scrollHeight - sc.clientHeight));
    return { ok: true, delta, scrollTop: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight };
  }, gapPx);
  await page.waitForTimeout(800);
  return info;
}

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(500);
  const p = `${OUT}/${name}.png`;
  if (opts.el) await page.locator(opts.el).first().screenshot({ path: p });
  else await page.screenshot({ path: p });
  console.log('  📸', p);
  return p;
}

/* ───────────────────────── measurements ───────────────────────── */

const readBalance = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="balance-card"]');
  if (!card) return { found: false };
  const cs = getComputedStyle(card);
  const box = card.getBoundingClientRect();
  const inner = ['balance-amount', 'see-holdings'].map((t) => document.querySelector(`[data-testid="${t}"]`));
  const labelEl = card.querySelector('div');
  const labelBox = labelEl ? labelEl.getBoundingClientRect() : null;
  const anchor = document.querySelector('[data-testid="balance-amount"]');
  const aBox = anchor ? anchor.getBoundingClientRect() : null;
  return {
    found: true,
    background: cs.backgroundColor,
    borderWidth: cs.borderTopWidth,
    borderStyle: cs.borderTopStyle,
    borderColor: cs.borderTopColor,
    borderRadius: cs.borderTopLeftRadius,
    paddingTop: parseFloat(cs.paddingTop), paddingRight: parseFloat(cs.paddingRight),
    paddingBottom: parseFloat(cs.paddingBottom), paddingLeft: parseFloat(cs.paddingLeft),
    box: { x: box.x, y: box.y, w: box.width, h: box.height, right: box.right, bottom: box.bottom },
    // is it a real frame around the content?
    labelLeft: labelBox ? labelBox.left : null,
    amountLeft: aBox ? aBox.left : null,
    amountTop: aBox ? aBox.top : null,
    amountTopInside: aBox ? aBox.top > box.top : null,
    seeHoldingsInside: !!document.querySelector('[data-testid="balance-card"] [data-testid="see-holdings"]'),
    amountInside: !!document.querySelector('[data-testid="balance-card"] [data-testid="balance-amount"]'),
    todayInside: !!(card.textContent || '').includes('Today') && !!(card.textContent || '').includes('Total'),
    canvasBg: getComputedStyle(document.querySelector('.content-area') || document.body).backgroundColor,
  };
});

const readRail = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="insight-card"][data-trigger-type="concentration_single"]');
  if (!card) return { found: false };
  const B = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2 }; };
  const row = card.querySelector('[data-testid="concentration-top-row"]');
  const ring = card.querySelector('[data-testid="donut-column"] svg');
  const rail = card.querySelector('[data-testid="card-right-col"]');
  const rowsEls = [...card.querySelectorAll('[data-testid="donut-legend-row"]')];
  const stat = card.querySelector('[data-testid="hero-stat"]');
  const cardB = B(card);
  const rowB = B(row);
  return {
    found: true,
    railW: rail ? B(rail).w : null,
    ringW: ring ? Math.round(B(ring).w) : null,
    rows: rowsEls.map((el) => ({ text: (el.textContent || '').replace(/\s+/g, ' ').trim() })),
    rowKids: row ? row.children.length : 0,
    rowH: rowB ? Math.round(rowB.h * 10) / 10 : null,
    cardH: cardB ? Math.round(cardB.h) : null,
    statText: stat ? stat.textContent.trim() : '',
    hasEmptyRail: !!card.querySelector('[data-testid="card-right-col"], [data-testid="card-left-col"]'),
  };
});

const readBarAndContent = (page) => page.evaluate(() => {
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const bar = q('ask-rufus-bar') || document.querySelector('.ask-rufus-bar');
  const nav = document.querySelector('nav.fixed');
  const scroller = [...document.querySelectorAll('.content-area, .app-shell, div')]
    .filter((e) => e.scrollHeight > e.clientHeight + 40)
    .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
  const candidates = [
    ['quick-links', document.querySelector('[data-testid^="quick-link"]')],
    ['deck', q('hero-deck')],
    ['dots', q('deck-dots')],
  ];
  const all = [...(scroller ? scroller.querySelectorAll('*') : [])]
    .filter((e) => {
      if (e.getAttribute('aria-hidden') === 'true' || e.closest('[aria-hidden="true"]')) return false;
      if (e.closest('nav') || e.closest('[data-testid="ask-rufus-bar"]')) return false;
      const b = e.getBoundingClientRect();
      return b.width > 40 && b.height > 12 && b.bottom <= window.innerHeight;
    });
  const lowest = all.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
  const B = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; };
  const cs = scroller ? getComputedStyle(scroller) : null;
  const barCs = bar ? getComputedStyle(bar) : null;
  return {
    bar: B(bar), barPosition: barCs ? barCs.position : null, barHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
    navTop: nav ? nav.getBoundingClientRect().top : null,
    scrollerPadBottom: cs ? parseFloat(cs.paddingBottom) : null,
    scrollerMarginBottom: cs ? parseFloat(cs.marginBottom) : null,
    scrollerClientBottom: scroller ? scroller.getBoundingClientRect().bottom : null,
    scrollerMax: scroller ? { scrollTop: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight, clientH: scroller.clientHeight } : null,
    deck: B(q('hero-deck')), dots: B(q('deck-dots')),
    lowestContent: lowest ? { tag: lowest.tagName, testid: lowest.getAttribute('data-testid'), ...B(lowest) } : null,
    atMax: scroller ? Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight)) < 2 : false,
  };
});

const readDots = (page) => page.evaluate(() => {
  const wrap = document.querySelector('[data-testid="deck-dots"]');
  const dots = [...document.querySelectorAll('[data-testid="deck-dot"]')];
  const cards = [...document.querySelectorAll('[data-testid="insight-card"], [data-testid="deck-teaser-card"]')];
  const wrapText = wrap ? getComputedStyle(wrap) : null;
  const b = wrap ? wrap.getBoundingClientRect() : null;
  const deck = document.querySelector('[data-testid="hero-deck"]');
  const db = deck ? deck.getBoundingClientRect() : null;
  return {
    exists: !!wrap,
    visible: !!(wrap && b && b.width > 0 && b.height > 0 && wrapText.display !== 'none' && wrapText.visibility !== 'hidden'),
    count: dots.length,
    cardCount: cards.length,
    inViewport: !!(b && b.top >= 0 && b.bottom <= window.innerHeight),
    dotBox: b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null,
    deckBottom: db ? db.bottom : null,
    belowDeck: !!(b && db && b.top >= db.bottom - 1),
    aria: dots.map((d) => ({ active: d.getAttribute('data-active'), bg: getComputedStyle(d).backgroundColor, w: Math.round(d.getBoundingClientRect().width) })),
  };
});

(async () => {
  const browser = await chromium.launch();
  console.log('\n=== A. "YOUR PORTFOLIO" balance block must be a CARD ===');
  {
    const { ctx, page } = await setup(browser);
    if (await gotoInsights(page)) {
      const b = await readBalance(page);
      rec('A1 balance-card exists', b.found);
      if (b.found) {
        rec('A2 white fill (--v-card) in light theme', b.background === 'rgb(255, 255, 255)', b.background);
        rec('A3 0.5px hairline #E7EAE4', parseFloat(b.borderWidth) > 0 && parseFloat(b.borderWidth) <= 1 && b.borderStyle === 'solid' && b.borderColor === 'rgb(231, 234, 228)',
          `${b.borderWidth} ${b.borderStyle} ${b.borderColor}`);
        rec('A4 rounded corners', parseFloat(b.borderRadius) >= 12, b.borderRadius);
        rec('A5 real padding on all sides (≥14px)', Math.min(b.paddingTop, b.paddingRight, b.paddingBottom, b.paddingLeft) >= 14,
          `t${b.paddingTop} r${b.paddingRight} b${b.paddingBottom} l${b.paddingLeft}`);
        rec('A6 wraps label + balance + Today/Total + See Holdings', b.amountInside && b.seeHoldingsInside && b.todayInside,
          `amount=${b.amountInside} seeHoldings=${b.seeHoldingsInside} todayTotal=${b.todayInside}`);
        rec('A7 content is inset from the card edge (frame, not bare text)',
          b.amountLeft !== null && (b.amountLeft - b.box.x) >= 14 && b.amountTop > b.box.y,
          `leftPad=${b.amountLeft === null ? 'n/a' : (b.amountLeft - b.box.x).toFixed(1)} topPad=${b.amountTop === null ? 'n/a' : (b.amountTop - b.box.y).toFixed(1)}`);
        console.log('     card box:', JSON.stringify(b.box), 'canvas:', b.canvasBg);
      }
      await shot(page, 'R-A1-balance-card-context');
      await shot(page, 'R-A2-balance-card', { el: '[data-testid="balance-card"]' });
      // full-width balance card on a taller viewport too
      await page.setViewportSize({ width: 430, height: 1400 });
      await page.waitForTimeout(600);
      await shot(page, 'R-A3-balance-card-wide');
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await setup(browser, { theme: 'dark' });
    if (await gotoInsights(page)) {
      const b = await readBalance(page);
      rec('A8 dark parity: panel fill + dark hairline', b.found && b.background === 'rgb(10, 15, 30)' && b.borderColor === 'rgb(20, 28, 46)',
        `${b.background} / ${b.borderColor}`);
      await shot(page, 'R-A4-balance-card-dark', { el: '[data-testid="balance-card"]' });
    }
    await ctx.close();
  }

  console.log('\n=== B. concentration card: donut rail + legend REMOVED (round 4) ===');
  {
    const { ctx, page } = await setup(browser, { dsf: 3 });
    if (await gotoInsights(page)) {
      const r = await readRail(page);
      if (r.found) {
        rec('B1 ROUND 4: no donut rail column survives (card-right-col gone)', !r.railW && !r.ringW, `railW=${r.railW}`);
        rec('B2 ROUND 4: no ring rendered', !r.ringW && r.ringW !== 0, `ringW=${r.ringW}`);
        rec('B3 ROUND 4: no legend rows rendered', r.rows.length === 0, `rows=${r.rows.length}`);
        rec('B4 top row holds exactly category + stat (2 children, one line)',
          r.rowKids === 2 && r.rowH <= 54, `kids=${r.rowKids} h=${r.rowH}`);
        rec('B5 no absolutely/grid-positioned leftovers (no empty rail box)',
          !r.hasEmptyRail, `hasEmptyRail=${r.hasEmptyRail}`);
        rec('B6 stat still shows the REAL share (removal changed no data)', (r.statText || '').includes(expStat),
          `stat="${r.statText}" expected "${expStat}"`);
        rec('B7 the freed space is reclaimed — card is shorter than the round-3 rail layout',
          r.cardH <= 260, `cardH=${r.cardH} (round-3 rail layout measured ≈250 with the ring row)`);
        console.log('     card:', JSON.stringify({ cardH: r.cardH, rowH: r.rowH, kids: r.rowKids }));
      } else rec('B1 concentration card found', false);
      await shot(page, 'R-B1-concentration-card', { el: '[data-testid="insight-card"][data-trigger-type="concentration_single"]' });
    }
    await ctx.close();
  }

  console.log('\n=== C. Ask Rufus bar vs content (reserved space) ===');
  {
    const { ctx, page } = await setup(browser);
    if (await gotoInsights(page)) {
      // 1) scroll so the deck sits fully visible, bar right underneath it
      const s1 = await scrollTo(page, 'hero-deck', 300);
      const mid = await readBarAndContent(page);
      await shot(page, 'R-C1-deck-above-bar');
      const deckClearMid = mid.bar && mid.deck ? mid.bar.top - mid.deck.bottom : null;
      rec('C1 bar sits below the deck in this scroll position (no overlap)', deckClearMid !== null && deckClearMid >= 0,
        `deckBottom=${mid.deck ? mid.deck.bottom.toFixed(1) : 'n/a'} barTop=${mid.bar ? mid.bar.top.toFixed(1) : 'n/a'} clearance=${deckClearMid === null ? 'n/a' : deckClearMid.toFixed(1)}`);
      rec('C1b scroll actually moved (scroller responsive)', !!(s1 && s1.ok && s1.max > 40), JSON.stringify(s1));
      rec('C1e STRUCTURAL: the scroll viewport is clipped above the bar (nothing can render behind it)',
        mid.scrollerClientBottom !== null && mid.bar && mid.scrollerClientBottom <= mid.bar.top + 0.5,
        `scrollerBottom=${mid.scrollerClientBottom === null ? 'n/a' : mid.scrollerClientBottom.toFixed(1)} barTop=${mid.bar ? mid.bar.top.toFixed(1) : 'n/a'}`);

      // 1b) the UNambiguous shot: deck bottom ~24px above the bar, nothing between
      const s2 = await scrollDeckBottomAboveBar(page, 24);
      const tight = await readBarAndContent(page);
      const tightClear = tight.bar && tight.deck ? tight.bar.top - tight.deck.bottom : null;
      await shot(page, 'R-C1b-deck-bottom-vs-bar');
      rec('C1c deck bottom never crosses the bar (tight scroll)', tightClear !== null && tightClear >= 0,
        `deckBottom=${tight.deck ? tight.deck.bottom.toFixed(1) : 'n/a'} barTop=${tight.bar ? tight.bar.top.toFixed(1) : 'n/a'} clearance=${tightClear === null ? 'n/a' : tightClear.toFixed(1)} ${JSON.stringify(s2)}`);

      // 1c) horizontally scroll the deck to the Daily Brief / Weekly Snapshot
      //     teaser so the teaser card and the floating bar share one frame.
      const tinfo = await page.evaluate(() => {
        const deck = document.querySelector('[data-testid="hero-deck"]');
        if (!deck) return { ok: false };
        deck.scrollLeft = deck.scrollWidth;
        return { ok: true, scrollLeft: deck.scrollLeft, max: deck.scrollWidth - deck.clientWidth };
      });
      await page.waitForTimeout(1000);
      const teaserBox = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-testid="insight-card"]')];
        const last = cards[cards.length - 1];
        const bar = document.querySelector('[data-testid="ask-rufus-bar"]') || document.querySelector('.ask-rufus-bar');
        if (!last || !bar) return null;
        const b = last.getBoundingClientRect(), r = bar.getBoundingClientRect();
        return { kind: last.getAttribute('data-card-kind'), bottom: b.bottom, top: b.top, barTop: r.top, clearance: r.top - b.bottom, cards: cards.length };
      });
      await shot(page, 'R-C1c-teaser-card-vs-bar');
      rec('C1d teaser card + bar in one frame, no overlap', !!teaserBox && teaserBox.clearance >= 0,
        `${JSON.stringify(teaserBox)} deckScroll=${JSON.stringify(tinfo)}`);

      // 2) max scroll — nothing may be trapped under the bar
      await page.evaluate(() => {
        const sc = [...document.querySelectorAll('div')].filter((e) => e.scrollHeight > e.clientHeight + 40)
          .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];
        if (sc) sc.scrollTop = sc.scrollHeight;
      });
      await page.waitForTimeout(900);
      const bottom = await readBarAndContent(page);
      const clear = bottom.bar && bottom.lowestContent ? bottom.bar.top - bottom.lowestContent.bottom : null;
      rec('C2 at max scroll the lowest content clears the bar', clear !== null && clear >= 0,
        `lowest=${bottom.lowestContent ? bottom.lowestContent.tag + (bottom.lowestContent.testid ? '[' + bottom.lowestContent.testid + ']' : '') : 'n/a'} bottom=${bottom.lowestContent ? bottom.lowestContent.bottom.toFixed(1) : 'n/a'} barTop=${bottom.bar ? bottom.bar.top.toFixed(1) : 'n/a'} clearance=${clear === null ? 'n/a' : clear.toFixed(1)}`);
      rec('C3 the scroll container is CLIPPED above the bar (margin reserved = bar footprint) so padding-only clearance is no longer relied on',
        bottom.scrollerMarginBottom !== null && bottom.barHeight !== null && bottom.scrollerMarginBottom >= bottom.barHeight,
        `marginBottom=${bottom.scrollerMarginBottom} padBottom=${bottom.scrollerPadBottom} barHeight=${bottom.barHeight}`);
      rec('C4 bar is fixed above the bottom nav, not overlapping it', !!bottom.bar && bottom.bar.bottom <= bottom.navTop + 1,
        `barBottom=${bottom.bar ? bottom.bar.bottom.toFixed(1) : 'n/a'} navTop=${bottom.navTop === null ? 'n/a' : bottom.navTop.toFixed(1)}`);
      await shot(page, 'R-C2-max-scroll-clearance');
    }
    await ctx.close();
  }

  console.log('\n=== D. deck dots ===');
  {
    const { ctx, page } = await setup(browser);
    if (await gotoInsights(page)) {
      await scrollTo(page, 'hero-deck', 240);
      const d = await readDots(page);
      rec('D1 deck-dots element renders', d.exists && d.visible, `exists=${d.exists} visible=${d.visible}`);
      rec('D2 one dot per deck card', d.count > 0 && d.count === d.cardCount, `dots=${d.count} cards=${d.cardCount}`);
      rec('D3 dots sit BELOW the deck', d.belowDeck, `deckBottom=${d.deckBottom ? d.deckBottom.toFixed(1) : 'n/a'} dotsTop=${d.dotBox ? d.dotBox.top.toFixed(1) : 'n/a'}`);
      rec('D4 dots in viewport after scrolling to the deck', d.inViewport, JSON.stringify(d.dotBox));
      rec('D5 first dot is the active one', d.aria.length > 0 && d.aria[0].active === 'true', JSON.stringify(d.aria.slice(0, 3)));
      await shot(page, 'R-D1-deck-dots');
    }
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n──────── ${results.length - failed.length}/${results.length} checks passed ────────`);
  if (failed.length) { failed.forEach((f) => console.log('  ❌', f.name, '—', f.detail)); process.exit(1); }
})().catch((e) => { console.error('harness error:', e); process.exit(2); });
