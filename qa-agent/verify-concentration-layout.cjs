// ─────────────────────────────────────────────────────────────
// Concentration-risk hero card — two-column layout verification
//
// What changed: the concentration card's body is now a two-column split
//   left  (flex 1.2): CONCENTRATION label → stat → supporting sentence → sub-line
//   right (fixed 108): donut + compact 2–3 line legend beneath it
// while RUFUS NOTICED + orb stay full-width above and the action row stays
// full-width below. Every OTHER deck card type keeps its old layout.
//
// What this harness proves:
//   C1–C2   the concentration card renders the two-column split (and only it)
//   C3–C6   header above / action row below, both full-width; column widths right
//   C7–C9   the donut + legend come from the REAL holdings (real proportions,
//           real top-2 tickers, percentages that match the actual market values)
//   C10     other card types (event/bounce/idle) do NOT get the two-column layout
//   C11     no overflow at a narrow device width (320px)
//   C12     swipe/dot behaviour is unchanged: browse-only, never an action
//
// All network is route-mocked with the real account's position fixture.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/concentration-layout';
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

/* ── REAL data: what the donut/legend MUST show (straight from the fixture) ── */
const rows = pos.alpaca;
const totalMV = rows.reduce((s, r) => s + (r.market_value || 0), 0);
const ranked = [...rows].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
const top1 = ranked[0];
const top2 = ranked[1];
const shareOf = (r) => ((r.market_value || 0) / totalMV) * 100;
const expTop1Sym = top1.symbol;
const expTop2Sym = top2.symbol;
const expTop1Pct = Math.round(shareOf(top1));
const expTop2Pct = Math.round(shareOf(top2));
const expOtherPct = Math.round(100 - shareOf(top1) - shareOf(top2));
const expTop1Share = shareOf(top1) / 100;
const expTop2Share = shareOf(top2) / 100;
const expStat = `${Math.round(shareOf(top1) * 10) / 10}%`;
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

// The concentration trigger's own numbers, derived from the REAL fixture so the
// card is honest end-to-end (stat, donut and legend all agree).
const CONC = item('mock-conc-single', 'concentration_single', 'Concentration risk',
  `${expTop1Sym} alone is ${expStat} of your portfolio. That single position outweighs everything else you own.`,
  'warn', '⚖️', 'REBALANCE', { pct: Number(shareOf(top1).toFixed(1)), symbol: expTop1Sym, symbols: [expTop1Sym] });
const EVENT_REVIEW = item('mock-event-review', 'event_impact', 'Earnings this week',
  'NVDA reports Thursday. Your position is large enough that the move will show up in your balance.',
  'accent', '📅', 'REVIEW_POSITION:NVDA', { severity: 'review', symbol: 'NVDA' });
const IDLE = item('mock-idle', 'idle_cash', 'Idle cash',
  "You're holding about $25,000 in cash that isn't working for you.", 'info', '💰', 'INVEST_CASH:25000', { amount: 25000 });
const BOUNCE = item('mock-bounce', 'bounce_back', 'Bounce back',
  'INTC is down but your thesis still holds. This is roughly where you added last time.',
  'accent', '📉', 'REVIEW_POSITION:INTC', { symbol: 'INTC' });
const NOTICED = [CONC, EVENT_REVIEW, IDLE, BOUNCE];

const DAILY = { content: 'MARKET: Tech leads the tape.\nPORTFOLIO: Financials are carrying the book.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

async function setup(browser, { viewport } = {}) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 430, height: 932 } });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, acct]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      localStorage.setItem('vantage:theme', 'light');
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, `snaptrade:${ALPACA}`]);

  const page = await ctx.newPage();
  const chatPosts = [];
  const dismissPosts = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|500|429/.test(m.text())) console.error('[page]', m.text().slice(0, 160)); });

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
  await routePath(page, '/api/ai/noticed', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { items: NOTICED } });
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/ai/noticed/dismiss', (r) => {
    try { dismissPosts.push(r.request().postDataJSON()); } catch { dismissPosts.push({}); }
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
  await routePath(page, '/api/chat', (r) => {
    try { chatPosts.push(r.request().postDataJSON()); } catch { chatPosts.push({}); }
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"text":"mocked"}\n\ndata: [DONE]\n\n' });
  });

  return { ctx, page, chatPosts, dismissPosts };
}

async function gotoInsights(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});
    const ok = await page.locator('[data-testid="hero-deck"]').first()
      .waitFor({ timeout: attempt === 0 ? 60000 : 90000 }).then(() => true).catch(() => false);
    if (ok) { await page.waitForTimeout(3000); return true; }
    console.log(`  ⚠️  hero-deck missing (attempt ${attempt + 1}) — reloading`);
  }
  const body = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => '');
  console.log('  ⚠️  giving up; body starts:', JSON.stringify(body));
  return false;
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(800);
  const p = `${OUT}/${name}.png`;
  if (opts.el) {
    await page.locator(opts.el).first().screenshot({ path: p }).catch(async () => { await page.screenshot({ path: p }); });
  } else if (opts.fullPage) {
    const prev = page.viewportSize() || { width: 430, height: 932 };
    await page.setViewportSize({ width: opts.width || 430, height: opts.height || 2400 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: p });
    await page.setViewportSize(prev);
    await page.waitForTimeout(350);
  } else {
    await page.screenshot({ path: p });
  }
  console.log('  📸', p);
  return p;
};

/** Everything we need to judge the concentration card's internals. */
const readConcCard = (page) => page.evaluate(() => {
  const card = document.querySelector('[data-testid="insight-card"][data-trigger-type="concentration_single"]');
  if (!card) return { found: false };
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const header = card.children[0];
  const col = card.querySelector('[data-testid="concentration-two-col"]');
  const left = card.querySelector('[data-testid="card-left-col"]');
  const right = card.querySelector('[data-testid="card-right-col"]');
  const cta = card.querySelector('[data-testid="card-primary-cta"]');
  const actionRow = cta ? cta.parentElement : null;
  const legendRows = [...card.querySelectorAll('[data-testid="donut-legend-row"]')].map((el) =>
    el.textContent.replace(/\s+/g, ' ').trim());
  const circles = [...card.querySelectorAll('svg circle')].map((c) => {
    const dash = (c.getAttribute('stroke-dasharray') || '').trim().split(/\s+/).map(Number);
    const len = dash[0], rest = dash[1];
    return { color: c.getAttribute('stroke'), fraction: len + rest > 0 ? len / (len + rest) : 0 };
  });
  // DOM order inside the left column (measured, not inferred)
  const seqEls = [
    ['category', left ? left.children[0] : null],
    ['stat', card.querySelector('[data-testid="hero-stat"]')],
    ['sentence', card.querySelector('[data-testid="card-sentence"]')],
    ['caption', card.querySelector('[data-testid="card-caption"]')],
  ].filter(([, el]) => !!el);
  const seq = seqEls.map(([n, el]) => [n, el.getBoundingClientRect().top]);
  const seqOrdered = seq.every(([, top], i) => i === 0 || top >= seq[i - 1][1] - 1);
  const stat = card.querySelector('[data-testid="hero-stat"]');
  const st = stat ? getComputedStyle(stat) : null;
  const cardBox = card.getBoundingClientRect();
  // overflow audit (decorative aria-hidden layers excluded)
  const offenders = [];
  card.querySelectorAll('*').forEach((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return;
    if (el.closest('[aria-hidden="true"]')) return;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) return;
    if (b.right > cardBox.right + 0.6 || b.left < cardBox.left - 0.6) {
      offenders.push(`${el.tagName}${el.getAttribute('data-testid') ? '[' + el.getAttribute('data-testid') + ']' : ''}`);
    }
  });
  return {
    found: true,
    twoCol: !!col, left: left ? r(left) : null, right: right ? r(right) : null,
    header: header ? r(header) : null, actionRow: actionRow ? r(actionRow) : null,
    col: col ? r(col) : null, card: r(card),
    legendRows, circles, order: seqOrdered ? seqEls.map(([n]) => n) : seqEls.map(([n]) => n),
    seqOrdered, seqTops: seq,
    statText: stat ? stat.textContent.trim() : null,
    statFont: st ? { family: st.fontFamily, style: st.fontStyle, weight: st.fontWeight, size: st.fontSize } : null,
    captionText: (card.querySelector('[data-testid="card-caption"]') || {}).textContent || '',
    sentenceText: (card.querySelector('[data-testid="card-sentence"]') || {}).textContent || '',
    categoryText: left && left.children[0] ? left.children[0].textContent.trim() : '',
    hasBounceChart: !!card.querySelector('svg line'),
    offenders,
    docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
}).catch((e) => ({ found: false, error: String(e) }));

(async () => {
  const browser = await chromium.launch();

  /* ═════════ setup A: normal phone width, light theme ═════════ */
  {
    const { ctx, page, chatPosts, dismissPosts } = await setup(browser, { viewport: { width: 430, height: 932 } });
    await gotoInsights(page);

    const c = await readConcCard(page);
    rec('C1 concentration card exists and uses the two-column split', c.found && c.twoCol, JSON.stringify(c.found ? { twoCol: c.twoCol } : c));

    if (c.found) {
      // ── structure: header above, action row below, both full-width ──
      rec('C2 RUFUS NOTICED header sits ABOVE both columns',
        c.header && c.col && c.header.bottom <= c.col.y + 1,
        `header.bottom=${c.header && c.header.bottom.toFixed(1)} col.top=${c.col && c.col.y.toFixed(1)}`);
      rec('C3 header spans the full card width (not column-scoped)',
        c.header && c.col && c.header.w >= c.col.w - 1,
        `header.w=${c.header && c.header.w.toFixed(1)} col.w=${c.col && c.col.w.toFixed(1)}`);
      rec('C4 action row sits BELOW both columns',
        c.actionRow && c.col && c.actionRow.y >= c.col.bottom - 1,
        `row.top=${c.actionRow && c.actionRow.y.toFixed(1)} col.bottom=${c.col && c.col.bottom.toFixed(1)}`);
      rec('C5 action row is full-width (spans both columns)',
        c.actionRow && c.col && c.actionRow.w >= c.col.w - 1,
        `row.w=${c.actionRow && c.actionRow.w.toFixed(1)} col.w=${c.col && c.col.w.toFixed(1)}`);

      // ── column geometry ──
      rec('C6 right column is the fixed ~108px donut rail',
        c.right && Math.abs(c.right.w - 108) <= 2, `right.w=${c.right && c.right.w.toFixed(1)}`);
      rec('C7 left column is the wider one (flex 1.2)',
        c.left && c.right && c.left.w > c.right.w, `left.w=${c.left && c.left.w.toFixed(1)} right.w=${c.right && c.right.w.toFixed(1)}`);
      rec('C8 columns sit side by side (right is to the right of left)',
        c.left && c.right && c.right.x >= c.left.right - 1, `left.right=${c.left && c.left.right.toFixed(1)} right.x=${c.right && c.right.x.toFixed(1)}`);
      rec('C9 columns are top-aligned with each other',
        c.left && c.right && Math.abs(c.left.y - c.right.y) <= 2, `Δy=${c.left && c.right ? Math.abs(c.left.y - c.right.y).toFixed(1) : 'n/a'}`);

      // ── left column content + order ──
      rec('C10 left column order = label → stat → sentence → sub-line',
        c.seqOrdered, JSON.stringify(c.seqTops));
      rec('C10b left column contains all four pieces',
        c.order.length === 4, JSON.stringify(c.order));
      rec('C11 category label reads CONCENTRATION',
        /CONCENTRATION/.test(c.categoryText || ''), (c.categoryText || '').trim().slice(0, 40));
      rec('C12 hero stat carries the REAL largest-holding share',
        (c.statText || '').includes(expStat), `rendered=${c.statText} expected=${expStat}`);
      const isSerif = (f) => /serif/i.test(f) && !/sans-serif/i.test(f);
      rec('C13 stat is ~30px bold sans, non-italic',
        !!c.statFont &&
        Number.parseFloat(c.statFont.size) >= 28 && Number.parseFloat(c.statFont.size) <= 32 &&
        Number(c.statFont.weight) >= 700 &&
        c.statFont.style !== 'italic' &&
        !isSerif(c.statFont.family),
        JSON.stringify(c.statFont));
      rec('C14 sub-line names the real largest holding',
        (c.captionText || '').includes(expTop1Sym) && /largest holding/i.test(c.captionText || ''),
        (c.captionText || '').trim());
      rec('C15 supporting sentence is present',
        (c.sentenceText || '').length > 30, (c.sentenceText || '').slice(0, 60));

      // ── right column: REAL donut + REAL legend ──
      rec('C16 legend is 2–3 lines (top holdings + Other, never every position)',
        c.legendRows.length >= 2 && c.legendRows.length <= 3, JSON.stringify(c.legendRows));
      rec(`C17 legend line 1 = ${expTop1Sym} ${expTop1Pct}% (real top holding)`,
        (c.legendRows[0] || '').includes(expTop1Sym) && (c.legendRows[0] || '').includes(String(expTop1Pct)),
        c.legendRows[0]);
      rec(`C18 legend line 2 = ${expTop2Sym} ${expTop2Pct}% (real #2 holding)`,
        (c.legendRows[1] || '').includes(expTop2Sym) && (c.legendRows[1] || '').includes(String(expTop2Pct)),
        c.legendRows[1]);
      rec('C19 legend line 3 = Other bucket for the rest',
        c.legendRows.length < 3 || (/other/i.test(c.legendRows[2] || '') && (c.legendRows[2] || '').includes(String(expOtherPct))),
        c.legendRows[2] || '(no third line)');
      rec('C20 legend does NOT list a 3rd individual position',
        !c.legendRows.some((r) => r.includes(ranked[2].symbol)), `ranked[2]=${ranked[2].symbol} rows=${JSON.stringify(c.legendRows)}`);

      const arc1 = c.circles[0] ? c.circles[0].fraction : -1;
      const arc2 = c.circles[1] ? c.circles[1].fraction : -1;
      rec('C21 donut arc 1 = real ' + expTop1Sym + ' proportion (±0.5pt)',
        Math.abs(arc1 - expTop1Share) <= 0.005,
        `arc=${(arc1 * 100).toFixed(2)}% expected=${(expTop1Share * 100).toFixed(2)}%`);
      rec('C22 donut arc 2 = real ' + expTop2Sym + ' proportion (±0.5pt)',
        Math.abs(arc2 - expTop2Share) <= 0.005,
        `arc=${(arc2 * 100).toFixed(2)}% expected=${(expTop2Share * 100).toFixed(2)}%`);
      rec('C23 donut ring count matches the legend (top-2 + Other)',
        c.circles.length === c.legendRows.length, `arcs=${c.circles.length} legend=${c.legendRows.length}`);

      await shot(page, 'C-concentration-two-col', { el: '[data-testid="insight-card"]' });
      await shot(page, 'C-insights-full', { fullPage: true });
    }

    /* ── C24: the OTHER card types keep their old single-column layout ── */
    const otherShapes = await page.evaluate(() => {
      const out = {};
      document.querySelectorAll('[data-testid="insight-card"]').forEach((el) => {
        const t = el.getAttribute('data-trigger-type');
        if (!t) return;
        out[t] = {
          twoCol: !!el.querySelector('[data-testid="concentration-two-col"]'),
          hasDonutColumn: !!el.querySelector('[data-testid="donut-column"]'),
          statSize: (() => { const s = el.querySelector('[data-testid="hero-stat"]'); return s ? getComputedStyle(s).fontSize : null; })(),
        };
      });
      return out;
    });
    const others = Object.keys(otherShapes).filter((t) => t !== 'concentration_single' && t !== 'concentration_top3');
    rec('C24 no other card type picked up the two-column treatment',
      others.length > 0 && others.every((t) => !otherShapes[t].twoCol && !otherShapes[t].hasDonutColumn),
      JSON.stringify(otherShapes));
    rec('C25 other card types keep the 34px stat size',
      others.every((t) => otherShapes[t].statSize === '34px'),
      others.map((t) => `${t}:${otherShapes[t].statSize}`).join(' '));

    /* ── C12: swipe still navigates and never acts (drag over the donut rail) ── */
    const deck = page.locator('[data-testid="hero-deck"]').first();
    const before = await deck.getAttribute('data-active-index');
    const box = await deck.boundingBox();
    const concRightCol = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="card-right-col"]');
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    // drag starting ON the new donut column — the riskiest place to start a swipe
    await page.mouse.move(concRightCol.x, concRightCol.y);
    await page.mouse.down();
    await page.mouse.move(concRightCol.x - 60, concRightCol.y, { steps: 6 });
    await page.mouse.move(box.x + 30, concRightCol.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    const after = await deck.getAttribute('data-active-index');
    rec('C26 swipe starting on the donut rail still navigates the deck',
      before !== after, `${before} → ${after}`);
    rec('C27 swipe fired NO chat request', chatPosts.length === 0, `${chatPosts.length} posts`);
    rec('C28 swipe fired NO dismiss/snooze', dismissPosts.length === 0, `${dismissPosts.length} posts`);
    const chatOpen = (await page.locator('[data-testid="chat-input"]').count()) > 0;
    rec('C29 swipe did not open the chat overlay', !chatOpen);
    const snoozeOpen = await page.locator('[data-testid="snooze-sheet"]').count();
    rec('C30 swipe did not open the snooze sheet', snoozeOpen === 0);
    const dot = await page.locator('[data-testid="deck-dot"][data-active="true"]').first().getAttribute('data-index').catch(() => null);
    rec('C31 dot indicator tracks the new active card', dot === after, `dot=${dot} active=${after}`);
    await shot(page, 'C-after-swipe-from-donut-rail');

    /* ── the CTA on the concentration card must still work (explicit tap) ── */
    await page.evaluate(() => {
      const d = document.querySelector('[data-testid="hero-deck"]');
      if (d) d.scrollLeft = 0;
    });
    await page.waitForTimeout(900);
    const cta = page.locator('[data-testid="insight-card"][data-trigger-type="concentration_single"] [data-testid="card-primary-cta"]').first();
    rec('C32 concentration card primary CTA is still present after the relayout', (await cta.count()) > 0);
    const secLink = page.locator('[data-testid="insight-card"][data-trigger-type="concentration_single"] [data-testid="card-secondary-link"]').first();
    const secStyle = (await secLink.count()) ? await secLink.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, decoration: s.textDecorationLine };
    }) : null;
    rec('C33 "Ask Rufus" link keeps the fixed accent, no-underline treatment',
      !!secStyle && secStyle.decoration === 'none', JSON.stringify(secStyle));

    await ctx.close();
  }

  /* ═════════ setup B: narrow device (320px) ═════════ */
  {
    const { ctx, page } = await setup(browser, { viewport: { width: 320, height: 700 } });
    await gotoInsights(page);
    const c = await readConcCard(page);
    rec('C35 narrow 320px: two-column split still renders', c.found && c.twoCol);
    if (c.found) {
      rec('C36 narrow 320px: no element overflows the card box', c.offenders.length === 0, JSON.stringify(c.offenders));
      rec('C37 narrow 320px: page has no horizontal scrollbar', c.docOverflow <= 0, `overflow=${c.docOverflow}px`);
      rec('C38 narrow 320px: right rail still 108px', Math.abs(c.right.w - 108) <= 2, `right.w=${c.right.w.toFixed(1)}`);
      rec('C39 narrow 320px: left column still has usable width', c.left.w >= 90, `left.w=${c.left.w.toFixed(1)}`);
      const statFits = c.statFont && Number.parseFloat(c.statFont.size) >= 28;
      rec('C40 narrow 320px: stat keeps its size and stays legible', statFits, JSON.stringify(c.statFont));
      rec('C41 narrow 320px: legend still 2–3 lines, nothing clipped',
        c.legendRows.length >= 2 && c.legendRows.length <= 3 && c.legendRows.every((r) => r.length > 2),
        JSON.stringify(c.legendRows));
      rec('C42 narrow 320px: action row still below the columns',
        c.actionRow.y >= c.col.bottom - 1, `row.top=${c.actionRow.y.toFixed(1)} col.bottom=${c.col.bottom.toFixed(1)}`);
      await shot(page, 'C-narrow-320-card', { el: '[data-testid="insight-card"]' });
      await shot(page, 'C-narrow-320-full');
    }
    await ctx.close();
  }

  /* ═════════ setup C: 360px (common small Android) ═════════ */
  {
    const { ctx, page } = await setup(browser, { viewport: { width: 360, height: 780 } });
    await gotoInsights(page);
    const c = await readConcCard(page);
    rec('C43 360px: no overflow and no page-level horizontal scroll',
      c.found && c.offenders.length === 0 && c.docOverflow <= 0,
      c.found ? `offenders=${JSON.stringify(c.offenders)} overflow=${c.docOverflow}` : 'card missing');
    await shot(page, 'C-360-card', { el: '[data-testid="insight-card"]' });
    await ctx.close();
  }

  /* ═════════ setup D: narrow width + short viewport — is the card
     actually USABLE (CTA reachable, not trapped under the floating
     Ask Rufus bar)? ═════════ */
  {
    const { ctx, page } = await setup(browser, { viewport: { width: 320, height: 700 } });
    await gotoInsights(page);

    // scroll the concentration card's action row to a comfortable position
    await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="insight-card"] [data-testid="card-primary-cta"]');
      if (cta) cta.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(1200);

    const hit = await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="insight-card"] [data-testid="card-primary-cta"]');
      const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
      if (!cta) return { ok: false, reason: 'no cta' };
      const b = cta.getBoundingClientRect();
      const top = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const inside = !!top && (top === cta || cta.contains(top));
      const barBox = bar ? bar.getBoundingClientRect() : null;
      return {
        ok: inside, top: top ? top.tagName + (top.getAttribute('data-testid') ? '[' + top.getAttribute('data-testid') + ']' : '') : null,
        ctaBottom: b.bottom, barTop: barBox ? barBox.top : null, vh: window.innerHeight,
        covers: barBox ? Math.max(0, Math.min(b.bottom, barBox.bottom) - Math.max(b.y, barBox.top)) : 0,
      };
    });
    rec('C44 narrow+short: CTA is hit-testable (nothing permanently covering it)',
      hit.ok, JSON.stringify(hit));
    rec('C45 narrow+short: the floating Ask Rufus bar is not sitting on the CTA',
      hit.barTop == null || hit.ctaBottom <= hit.barTop + 1, `ctaBottom=${hit.ctaBottom && hit.ctaBottom.toFixed(1)} barTop=${hit.barTop && hit.barTop.toFixed(1)}`);
    await shot(page, 'C-narrow-320-cta-visible');

    // geometry sanity: real gutter between columns, legend inside the padding box
    const geo = await readConcCard(page);
    const gutter = geo.left && geo.right ? geo.right.x - geo.left.right : null;
    rec('C46 column gutter is a deliberate 14px (not touching)',
      gutter != null && Math.abs(gutter - 14) <= 1, `gutter=${gutter && gutter.toFixed(1)}px`);
    const legendInside = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="insight-card"]');
      const row = document.querySelector('[data-testid="donut-legend-row"]');
      const cb = card.getBoundingClientRect(), rb = row.getBoundingClientRect();
      const rowRight = row.lastElementChild ? row.lastElementChild.getBoundingClientRect().right : rb.right;
      return { cardRight: cb.right, rowRight };
    });
    rec('C47 legend percentages stay inside the card padding box',
      legendInside.rowRight <= legendInside.cardRight - 4,
      `rowRight=${legendInside.rowRight.toFixed(1)} cardRight=${legendInside.cardRight.toFixed(1)}`);
    await ctx.close();
  }

  await browser.close();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, expectations: {
    top1: `${expTop1Sym} ${expTop1Pct}%`, top2: `${expTop2Sym} ${expTop2Pct}%`, other: expOtherPct + '%', stat: expStat,
  }, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  try {
    const passed = results.filter((r) => r.pass).length;
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results, crashed: String(e) }, null, 2));
  } catch {}
  process.exit(1);
});
