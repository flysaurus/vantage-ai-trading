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
const OUT = '/tmp/vantage-shots/insights-round3';
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
  const rail = card.querySelector('[data-testid="card-right-col"]');
  const col = card.querySelector('[data-testid="donut-column"]');
  const legend = card.querySelector('[data-testid="donut-legend"]');
  const ring = card.querySelector('[data-testid="donut-column"] svg');
  const rowsEls = [...card.querySelectorAll('[data-testid="donut-legend-row"]')];
  const B = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, w: b.width, h: b.height, cx: b.left + b.width / 2 }; };
  const railB = rail ? B(rail) : null;
  const ringB = ring ? B(ring) : null;
  const legendB = legend ? B(legend) : null;
  const rowBs = rowsEls.map(B);
  const gaps = rowBs.slice(1).map((r, i) => r.top - rowBs[i].bottom);
  const pinned = rowsEls.map((el) => {
    const spans = [...el.querySelectorAll('span')];
    // [chip, symbol, pct] — join the two text spans with a space for comparison
    const symbol = spans[1] ? spans[1].textContent.trim() : '';
    const pct = spans[2] ? spans[2].textContent.trim() : '';
    return {
      text: `${symbol} ${pct}`,
      overflow: spans[1] ? spans[1].scrollWidth - spans[1].clientWidth : 0,
    };
  });
  return {
    found: true,
    railW: railB ? Math.round(railB.w * 10) / 10 : null,
    railCx: railB ? railB.cx : null,
    ringCx: ringB ? ringB.cx : null,
    ringW: ringB ? Math.round(ringB.w) : null,
    ringLeft: ringB ? ringB.left : null, ringRight: ringB ? ringB.right : null,
    legendLeft: legendB ? legendB.left : null, legendRight: legendB ? legendB.right : null,
    legendW: legendB ? Math.round(legendB.w * 10) / 10 : null,
    colGap: (() => { const c = getComputedStyle(col); return parseFloat(c.rowGap || c.gap); })(),
    colHeight: col ? Math.round(col.getBoundingClientRect().height) : null,
    ringToLegend: ringB && legendB ? Math.round((legendB.top - ringB.bottom) * 10) / 10 : null,
    rowGapCss: (() => { const l = getComputedStyle(legend); return parseFloat(l.rowGap || l.gap); })(),
    rowGaps: gaps.map((g) => Math.round(g * 10) / 10),
    rows: pinned,
    railBottom: railB ? railB.bottom : null,
    legendBottom: legendB ? legendB.bottom : null,
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


/* ═══════════════ ROUND 3 (Em's corrected sizing — SUPERSEDES v1) ═══════════════
   Concentration card: compact top row (stat ~28px + 66px donut, top-1 + Other
   legend), FULL-WIDTH sentence/sub-line beneath it, action row on ONE line with
   Remind right-aligned. Your Portfolio card: 12px orb left of the label.
   Ask Rufus bar: must float clear of content at EVERY scroll position — proven
   with a clipped-visible-rect sweep, not a single measurement.
   ═══════════════════════════════════════════════════════════════════════════ */

/* New-contract expectations from the REAL fixture */
const expStatTop1 = `${Math.round(shareOf(top1) * 10) / 10}%`;        // e.g. 30.3%
const expLegendV2 = [`${top1.symbol} ${Math.round(shareOf(top1))}%`,
  `Other ${Math.round(100 - shareOf(top1))}%`];

const readConcentrationV2 = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="insight-card"][data-trigger-type="concentration_single"]')
    || document.querySelector('[data-testid="insight-card"][data-trigger-type="concentration_top3"]');
  if (!card) return { found: false };
  const q = (t) => document.querySelector(`[data-testid="${t}"]`);
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 }; };
  const row = q('concentration-top-row');
  const stat = q('hero-stat');
  const ring = card.querySelector('[data-testid="donut-column"] svg');
  const legend = q('donut-legend');
  const legendRows = [...document.querySelectorAll('[data-testid="donut-legend-row"]')].map((r) => {
    const spans = [...r.querySelectorAll('span')];
    return { text: `${spans[1] ? spans[1].textContent.trim() : ''} ${spans[2] ? spans[2].textContent.trim() : ''}`.trim() };
  });
  const sentence = q('card-sentence');
  const caption = q('card-caption');
  const actionRow = q('card-action-row') || q('card-primary-cta').parentElement;
  const cta = q('card-primary-cta');
  const ask = q('card-secondary-link');
  const snooze = q('card-snooze');
  const ctaR = R(cta), askR = R(ask), snoozeR = R(snooze);
  const cardCS = getComputedStyle(card);
  const statCS = getComputedStyle(stat);
  const senCS = getComputedStyle(sentence);
  const cardBox = card.getBoundingClientRect();
  const leftEdge = cardBox.left + parseFloat(cardCS.paddingLeft);
  const rightEdge = cardBox.right - parseFloat(cardCS.paddingRight);
  const rowCS = getComputedStyle(actionRow);
  return {
    found: true,
    card: R(card), cardBox: { x: cardBox.left, y: cardBox.top, w: cardBox.width, h: cardBox.height },
    cardPad: { t: parseFloat(cardCS.paddingTop), r: parseFloat(cardCS.paddingRight), b: parseFloat(cardCS.paddingBottom), l: parseFloat(cardCS.paddingLeft) },
    contentLeft: leftEdge, contentRight: rightEdge,
    row: R(row), stat: R(stat), ring: R(ring), legend: R(legend), legendRows,
    ringSize: ring ? { w: Math.round(ring.getBoundingClientRect().width), h: Math.round(ring.getBoundingClientRect().height) } : null,
    statFontSize: stat ? parseFloat(statCS.fontSize) : null,
    statWeight: stat ? statCS.fontWeight : null,
    statSerif: /serif/i.test(statCS.fontFamily) && !/sans-serif/i.test(statCS.fontFamily),
    statItalic: statCS.fontStyle === 'italic',
    sentence: R(sentence), sentenceLineHeight: senCS.lineHeight, sentenceFontSize: parseFloat(senCS.fontSize),
    caption: R(caption),
    actionRow: R(actionRow), actionWrap: rowCS.flexWrap, actionGap: parseFloat(rowCS.gap || rowCS.columnGap),
    cta: ctaR, ask: askR, snooze: snoozeR,
    snoozeML: snooze ? getComputedStyle(snooze).marginLeft : null,
    snoozeSpecifiedML: snooze ? snooze.style.marginLeft : null,
    snoozeInline: !!(snoozeR && askR && ctaR && Math.abs(snoozeR.cy - askR.cy) <= 2 && Math.abs(snoozeR.cy - ctaR.cy) <= 2),
  };
});

const readBalanceOrb = (page) => page.evaluate(() => {
  const orb = document.querySelector('[data-testid="balance-orb"]');
  const card = document.querySelector('[data-testid="balance-card"]');
  if (!card) return { found: false };
  const label = [...card.querySelectorAll('span')].find((s) => (s.textContent || '').trim() === 'YOUR PORTFOLIO');
  const R = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, w: b.width, h: b.height, cy: (b.top + b.bottom) / 2 }; };
  const cs = orb ? getComputedStyle(orb) : null;
  return {
    found: true,
    orb: R(orb), label: R(label),
    orbExists: !!orb,
    size: orb ? Math.round(orb.getBoundingClientRect().width) : null,
    bgImage: cs ? cs.backgroundImage : null,
    radius: cs ? cs.borderRadius : null,
    leftOfLabel: !!(orb && label && orb.getBoundingClientRect().right <= label.getBoundingClientRect().left + 1),
    sameRow: !!(orb && label && Math.abs(((orb.getBoundingClientRect().top + orb.getBoundingClientRect().bottom) / 2) - ((label.getBoundingClientRect().top + label.getBoundingClientRect().bottom) / 2)) <= 3),
    heroOrbBg: (() => {
      const heroOrb = document.querySelector('[data-testid="insight-card"] [aria-hidden="true"]');
      return heroOrb ? getComputedStyle(heroOrb).backgroundImage : null;
    })(),
  };
});

/** The core proof: for scrollTop 0→max, is ANY content visible in the bar band?
 *  Uses CLIPPED visible rects (element rect ∩ scroller client rect) — an
 *  unclipped getBoundingClientRect is NOT evidence when an ancestor clips. */
const sweepBarOverlap = (page, steps = 40) => page.evaluate((STEPS) => {
  const sc = document.querySelector('.content-area');
  if (!sc) return { ok: false, reason: 'no .content-area' };
  const bar = document.querySelector('[data-testid="ask-rufus-bar"]') || document.querySelector('.ask-rufus-bar');
  if (!bar) return { ok: false, reason: 'no ask-rufus-bar' };
  const barBox = bar.getBoundingClientRect();
  const nav = document.querySelector('nav.fixed');
  const scBox0 = sc.getBoundingClientRect();
  const max = sc.scrollHeight - sc.clientHeight;
  const orig = sc.scrollTop;
  let worst = { gap: Infinity }, hits = [];
  for (let i = 0; i <= STEPS; i++) {
    sc.scrollTop = Math.round((max * i) / STEPS);
    const scb = sc.getBoundingClientRect();
    // visible band of the scroller
    const vTop = Math.max(scb.top, 0), vBottom = Math.min(scb.bottom, window.innerHeight);
    const cand = [...sc.querySelectorAll('button, a, [role="button"], [data-testid]')].filter((e) => {
      if (e.getAttribute('aria-hidden') === 'true' || e.closest('[aria-hidden="true"]')) return false;
      if (e.closest('[data-testid="ask-rufus-bar"]') || e.closest('nav')) return false;
      const b = e.getBoundingClientRect();
      return b.width > 8 && b.height > 8;
    });
    for (const e of cand) {
      const b = e.getBoundingClientRect();
      const visTop = Math.max(b.top, vTop), visBottom = Math.min(b.bottom, vBottom);
      if (visBottom - visTop <= 0) continue;                 // fully clipped → invisible
      const gap = barBox.top - visBottom;                    // >0 ⇒ clears the bar
      if (gap < worst.gap) worst = { gap, tag: e.tagName, testid: e.getAttribute('data-testid'), scrollTop: sc.scrollTop, visBottom, barTop: barBox.top };
      if (visBottom > barBox.top + 0.5) hits.push({ tag: e.tagName, testid: e.getAttribute('data-testid'), visBottom, barTop: barBox.top, scrollTop: sc.scrollTop, mount: b.height });
    }
  }
  sc.scrollTop = orig;
  return {
    ok: true,
    scrollerTop: scBox0.top, scrollerBottom: scBox0.bottom, scrollerClientH: sc.clientHeight,
    barTop: barBox.top, navTop: nav ? nav.getBoundingClientRect().top : null,
    max, worst, hits: hits.slice(0, 6), hitCount: hits.length, steps: STEPS,
  };
}, steps);


// ─── screenshot-only pass: the previously-overlapping scroll positions ───
(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await setup(browser, { viewport: { width: 430, height: 932 } });
  await gotoInsights(page);
  await page.waitForTimeout(2500);

  const park = (frac) => page.evaluate(async (f) => {
    const sc = document.querySelector('.content-area');
    const r = document.querySelector('[data-testid="card-action-row"]');
    const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
    const max = sc.scrollHeight - sc.clientHeight;
    sc.scrollTop = Math.round(max * f);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const scb = sc.getBoundingClientRect(), rb = r.getBoundingClientRect(), bb = bar.getBoundingClientRect();
    return {
      scrollTop: sc.scrollTop, max,
      scrollerBottom: +scb.bottom.toFixed(1), barTop: +bb.top.toFixed(1),
      rowTop: +rb.top.toFixed(1), rowBottom: +rb.bottom.toFixed(1),
      rowVisibleBottom: +Math.min(rb.bottom, scb.bottom).toFixed(1),
      clipped: rb.bottom > scb.bottom,
      gap: +(bb.top - Math.min(rb.bottom, scb.bottom)).toFixed(1),
    };
  }, frac);

  for (const [name, frac] of [['S1-top', 0], ['S2-mid', 0.5], ['S3-bottom', 1]]) {
    const m = await park(frac);
    console.log(name, JSON.stringify(m));
    await shot(page, `R3-9-${name}-bar-band`, {});
  }

  // action row parked at its closest achievable approach, full frame + tight zoom
  await park(0);
  await page.waitForTimeout(600);
  await shot(page, 'R3-10-closest-approach-full', {});
  await shot(page, 'R3-11-closest-approach-zoom', { el: '[data-testid="card-action-row"]' });
  await shot(page, 'R3-12-balance-card-orb', { el: '[data-testid="balance-card"]' });

  await ctx.close();
  await browser.close();
  console.log('done:', OUT);
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
