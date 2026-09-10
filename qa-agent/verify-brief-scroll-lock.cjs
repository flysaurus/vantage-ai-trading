// ─────────────────────────────────────────────────────────────
// PART A + PART B verification harness
//
// PART A — Brief routing + modal + chat bridge
//   A1  Daily Brief teaser opens a MODAL (not Holdings, not chat)
//   A2  Modal shows the real daily brief sections (MARKET/PORTFOLIO/WATCH/EARNINGS)
//   A3  Weekly Snapshot teaser opens the same modal with the weekly body
//   A4  Modal is dismissible (close button / backdrop / Escape) → back to Insights
//   A5  "Ask Rufus about this" closes the modal + opens chat with the ACTUAL
//       brief text carried through as context
//   A6  The Insights tab is still the active tab throughout (never navigates away)
//
// PART B — Chat window overhaul
//   B1  No Chat / Deep Dive toggle in the chat header
//   B2  No persistent "N messages left" counter when there is plenty of quota
//   B3  A warning appears only when genuinely close to the tier limit
//       (min(5, 10% of the daily limit))
//   B4  "Go deeper" under a response re-runs that exchange on the deep tier and
//       RETURNS A MORE THOROUGH ANSWER in place (message count unchanged)
//   B5  Collapsing the chat returns to the tab the user came from (≥2 tabs)
//
// Everything is route-mocked; nothing hits production.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/brief-chat';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const base64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
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

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── fixture content ──
const DAILY_CONTENT = [
  'MARKET: Tech leads the tape while energy lags into the close.',
  'PORTFOLIO: XLF is carrying the book today, up 1.2% against a flat tape.',
  'WATCH: NVDA reports Thursday after the bell.',
  'EARNINGS: INTC reports next week — the options market is pricing a 6% move.',
].join('\n');

const WEEKLY_CONTENT = [
  '## Summary',
  'Concentration tightened again this week: your top holding grew from 26% to 30% of the book.',
  '',
  '## Portfolio Health (score 7/10)',
  'Returns held up, but diversification is the weak link.',
  '',
  '## Risk Level: MODERATE',
  'A single-name shock would move the portfolio more than you have tolerated historically.',
].join('\n');

const DAILY = { content: DAILY_CONTENT, cached: true, generatedAt: new Date(Date.now() - 3600e3).toISOString() };
const WEEKLY = { content: WEEKLY_CONTENT, healthScore: 7, riskLevel: 'moderate', cached: true, generatedAt: new Date(Date.now() - 7200e3).toISOString() };

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

function accountResponse(rows, cash, buyingPower) {
  const positions = rawPositions(rows);
  const mv = positions.reduce((s, p) => s + p.marketValue, 0);
  const pnl = positions.reduce((s, p) => s + p.openPnl, 0);
  return {
    totalValue: mv + cash, cash, buyingPower, invested: mv, marketValue: mv,
    dayChange: 0, dayChangePct: 0, totalPnl: pnl, totalPnlPct: 0, currency: 'USD',
    accountStatus: 'open', lastSynced: new Date().toISOString(),
    holdingsUnavailable: false, positions,
  };
}

const alpacaCash = 25000;
const alpMV = rawPositions(pos.alpaca).reduce((s, p) => s + p.marketValue, 0);

const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: alpMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];

const item = (id, type, title, body, variant, icon, action, extra = {}) => ({
  id, triggerKey: `${type}:${id}`, triggerType: type, title, body, followUp: '',
  variant, icon, meta: { action, ...extra }, action,
  createdAt: new Date(Date.now() - 3600e3).toISOString(), dismissedUntil: null,
});

const CONC_SINGLE = item('mock-conc-single', 'concentration_single', 'Concentration risk',
  'XLF alone is 30.3% of your portfolio. That single position outweighs everything else you own.',
  'warn', '⚖️', 'REBALANCE', { pct: 30.3, symbol: 'XLF', symbols: ['XLF'] });

function routePath(page, pathname, handler) {
  return page.route((url) => new URL(url).pathname === pathname, handler);
}

/** SSE body in the exact shape the client parser expects. */
const sse = (text) => `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`;

async function setupChat(browser, { remaining, dailyLimit, replyText, threadReplyText, theme, viewport, accountId = `snaptrade:${ALPACA}` }) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 430, height: 932 } });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, acct, th]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      if (th) localStorage.setItem('vantage:theme', th);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, accountId, theme || 'light']);

  const page = await ctx.newPage();
  const chatPosts = [];

  page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) console.error('[page]', m.text().slice(0, 200)); });

  const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);

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
    if (r.request().method() === 'GET') return r.fulfill({ json: { items: [CONC_SINGLE] } });
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/ai/noticed/dismiss', (r) => r.fulfill({ json: { ok: true } }));

  // ── usage mocks: the whole point of B2/B3 ──
  if (remaining !== undefined) {
    await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: remaining } }));
  }
  if (dailyLimit !== undefined || remaining !== undefined) {
    await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: {
      tier: 'silver',
      chat: { daily: { used: 0, limit: dailyLimit ?? 50 }, monthly: { used: 0, limit: 1000 } },
    }}));
  }

  // ── chat stream ──
  await routePath(page, '/api/chat', (r) => {
    let body = null;
    try { body = r.request().postDataJSON(); } catch {}
    chatPosts.push(body);
    const isDeep = body && body.mode === 'deep';
    const text = isDeep ? (threadReplyText || replyText) : replyText;
    return r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: sse(text),
    });
  });
  await routePath(page, '/api/ai/chat', (r) => r.fulfill({ json: { ok: true, content: 'mock' } }));

  return { ctx, page, chatPosts };
}

const hideDevOverlay = (page) =>
  page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});

async function gotoInsights(page) {
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await hideDevOverlay(page);
  await page.locator('[data-testid="hero-deck"], [data-testid="fallback-card"]').first().waitFor({ timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(900);
  const p = `${OUT}/${name}.png`;
  if (opts.fullPage) {
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

const clickTeaser = async (page, kind) => {
  const card = page.locator(`[data-testid="insight-card"][data-card-kind="${kind}"]`).first();
  await card.waitFor({ timeout: 15000 });
  await card.locator('[data-testid="card-primary-cta"]').first().evaluate((el) => el.click());
};

const openChat = async (page) => {
  await page.locator('[data-testid="ask-rufus-bar"]').first().evaluate((el) => el.click());
  await page.locator('[data-testid="chat-input"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
};

const ask = async (page, text) => {
  await page.locator('[data-testid="chat-input"]').fill(text);
  await page.locator('[data-testid="chat-input"]').press('Enter');
  await page.waitForTimeout(3000);
};


// ─────────────────────────────────────────────────────────────
// BRIEF MODAL SCROLL — verification harness
//
//  A. the background (Insights) is scroll-LOCKED while the sheet is open
//  B. the sheet's own content area scrolls independently, and the background is
//     PIXEL-IDENTICAL while it does (not just "didn't move a lot")
//  C. every dismiss path releases the lock and the page scrolls again
//  D. Weekly Snapshot (same component) behaves identically
//  E. dark theme parity + no stuck lock across open/close cycles
// ─────────────────────────────────────────────────────────────
const { PNG } = require('pngjs');
const LONG_DAILY = { content: "MARKET: Equities opened softly with the S&P off 0.3% while the 10-year pushed to 4.42%. Semis led the weakness and defensives caught a bid.\nPORTFOLIO: Your book is down $412 today, roughly -0.32%, in line with the broad market. XLF carries the drag at -0.9%, XLP offsets at +0.4%.\nWATCH: Watch the financials complex into Friday's bank earnings. A close under 51.00 in XLF would be the first below your average cost in seven weeks.\nEARNINGS: JPM and WFC report before the open Friday. Both matter to XLF specifically.\nMACRO: CPI lands Tuesday and consensus is 0.2% headline. A hot print puts the cuts back on ice.\nCASH: You still have $25,000 idle, about 19.7% of the account, idle for nine trading days now.\nRISK: Your top three positions are 71% of the book. That is the one number I would push back on.\nACTIONS: No trade is required today. If you want to do something useful, trim XLF into strength above 51.50.\nOUTLOOK: Base case is chop into next week's CPI, then a directional move on the print.\nMARKET: Equities opened softly with the S&P off 0.3% while the 10-year pushed to 4.42%. Semis led the weakness and defensives caught a bid.\nPORTFOLIO: Your book is down $412 today, roughly -0.32%, in line with the broad market. XLF carries the drag at -0.9%, XLP offsets at +0.4%.\nWATCH: Watch the financials complex into Friday's bank earnings. A close under 51.00 in XLF would be the first below your average cost in seven weeks.\nEARNINGS: JPM and WFC report before the open Friday. Both matter to XLF specifically.\nMACRO: CPI lands Tuesday and consensus is 0.2% headline. A hot print puts the cuts back on ice.\nCASH: You still have $25,000 idle, about 19.7% of the account, idle for nine trading days now.\nRISK: Your top three positions are 71% of the book. That is the one number I would push back on.\nACTIONS: No trade is required today. If you want to do something useful, trim XLF into strength above 51.50.\nOUTLOOK: Base case is chop into next week's CPI, then a directional move on the print.\nMARKET: Equities opened softly with the S&P off 0.3% while the 10-year pushed to 4.42%. Semis led the weakness and defensives caught a bid.\nPORTFOLIO: Your book is down $412 today, roughly -0.32%, in line with the broad market. XLF carries the drag at -0.9%, XLP offsets at +0.4%.\nWATCH: Watch the financials complex into Friday's bank earnings. A close under 51.00 in XLF would be the first below your average cost in seven weeks.\nEARNINGS: JPM and WFC report before the open Friday. Both matter to XLF specifically.\nMACRO: CPI lands Tuesday and consensus is 0.2% headline. A hot print puts the cuts back on ice.\nCASH: You still have $25,000 idle, about 19.7% of the account, idle for nine trading days now.\nRISK: Your top three positions are 71% of the book. That is the one number I would push back on.\nACTIONS: No trade is required today. If you want to do something useful, trim XLF into strength above 51.50.\nOUTLOOK: Base case is chop into next week's CPI, then a directional move on the print.\nMARKET: Equities opened softly with the S&P off 0.3% while the 10-year pushed to 4.42%. Semis led the weakness and defensives caught a bid.\nPORTFOLIO: Your book is down $412 today, roughly -0.32%, in line with the broad market. XLF carries the drag at -0.9%, XLP offsets at +0.4%.\nWATCH: Watch the financials complex into Friday's bank earnings. A close under 51.00 in XLF would be the first below your average cost in seven weeks.\nEARNINGS: JPM and WFC report before the open Friday. Both matter to XLF specifically.\nMACRO: CPI lands Tuesday and consensus is 0.2% headline. A hot print puts the cuts back on ice.\nCASH: You still have $25,000 idle, about 19.7% of the account, idle for nine trading days now.\nRISK: Your top three positions are 71% of the book. That is the one number I would push back on.\nACTIONS: No trade is required today. If you want to do something useful, trim XLF into strength above 51.50.\nOUTLOOK: Base case is chop into next week's CPI, then a directional move on the print.\n", cached: true, generatedAt: new Date(Date.now() - 3600e3).toISOString() };
const LONG_WEEKLY = { content: "## Portfolio\n\nYour book is up **1.2%** on the week, ahead of SPY by 40bp.\n\n## Risk\n\nConcentration is unchanged: XLF is still 30.3% of the account.\n\n## Actions\n\n- No trade required\n- Watch CPI Tuesday\n\n- Trim XLF above 51.50\n- Keep $25,000 dry\n\n### Notes\n\nCash is idle for the ninth straight session.\n## Portfolio\n\nYour book is up **1.2%** on the week, ahead of SPY by 40bp.\n\n## Risk\n\nConcentration is unchanged: XLF is still 30.3% of the account.\n\n## Actions\n\n- No trade required\n- Watch CPI Tuesday\n\n- Trim XLF above 51.50\n- Keep $25,000 dry\n\n### Notes\n\nCash is idle for the ninth straight session.\n## Portfolio\n\nYour book is up **1.2%** on the week, ahead of SPY by 40bp.\n\n## Risk\n\nConcentration is unchanged: XLF is still 30.3% of the account.\n\n## Actions\n\n- No trade required\n- Watch CPI Tuesday\n\n- Trim XLF above 51.50\n- Keep $25,000 dry\n\n### Notes\n\nCash is idle for the ninth straight session.\n", healthScore: 7, riskLevel: 'moderate', cached: true, generatedAt: new Date(Date.now() - 7200e3).toISOString() };

const OUT2 = '/tmp/vantage-shots/brief-scroll';
fs.mkdirSync(OUT2, { recursive: true });


const state = (page) => page.evaluate(() => {
  const el = (id) => document.querySelector('[data-testid="' + id + '"]');
  const ca = document.querySelector('.content-area');
  const mb = el('brief-modal-body');
  const root = document.documentElement;
  return {
    open: !!el('brief-modal'),
    kind: el('brief-modal') ? el('brief-modal').getAttribute('data-brief-kind') : null,
    bgScrollTop: ca ? Math.round(ca.scrollTop) : null,
    bgInlineOverflow: ca ? ca.style.overflow : null,
    bgComputedOverflow: ca ? getComputedStyle(ca).overflowY : null,
    bgInlineOverscroll: ca ? ca.style.overscrollBehavior : null,
    bodyInlineOverflow: document.body.style.overflow,
    htmlInlineOverflow: root.style.overflow,
    scrollScopeAttr: mb ? mb.getAttribute('data-scroll-scope') : null,
    mbScrollTop: mb ? Math.round(mb.scrollTop) : null,
    mbRange: mb ? (mb.scrollHeight - mb.clientHeight) : null,
    mbOverscroll: mb ? getComputedStyle(mb).overscrollBehaviorY : null,
    mc: mb ? mb.clientHeight : null,
  };
});

const wheelAt = async (page, dy, sel, frac) => {
  const box = await page.locator(sel).first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * (frac === undefined ? 0.5 : frac));
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(700);
};

const swipeAt = async (page, dy, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  const cx = box.x + box.width / 2;
  const y0 = box.y + box.height * 0.72;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: y0 }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: y0 - (dy * i) / 10 }] });
    await page.waitForTimeout(28);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
};

/** Screenshot the band ABOVE the sheet (pure background) as raw pixels. */
const bandShot = async (page, band) => {
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 430, height: band } });
  return PNG.sync.read(Buffer.from(buf));
};
const diffPixels = (a, b) => {
  let n = 0;
  const len = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < len; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) n++;
  }
  return n;
};

const openTeaser = async (page, kind) => {
  await clickTeaser(page, kind);
  await page.locator('[data-testid="brief-modal"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
};

(async () => {
  const browser = await chromium.launch();

  // ══════════ A/B/C — Daily Brief, light ══════════
  {
    const { ctx, page } = await setupChat(browser, { remaining: 40, dailyLimit: 50 });
    await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: LONG_DAILY }));
    await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: LONG_WEEKLY }));
    await gotoInsights(page);
    await page.evaluate(() => { const ca = document.querySelector('.content-area'); if (ca) ca.scrollTop = 260; });
    await page.waitForTimeout(400);

    await openTeaser(page, 'daily_brief');
    const s0 = await state(page);
    rec('A1 daily teaser opens the sheet', s0.open && s0.kind === 'daily', `kind=${s0.kind}`);
    await page.screenshot({ path: OUT2 + '/D1-daily-modal-top.png' });   // sheet at scrollTop 0

    rec('A2 the inner Insights scroller is LOCKED while open',
      s0.bgInlineOverflow === 'hidden' && s0.bgComputedOverflow === 'hidden',
      `.content-area inline="${s0.bgInlineOverflow}" computed=${s0.bgComputedOverflow}`);
    rec('A3 the lock also pins overscroll-behavior: contain on it',
      s0.bgInlineOverscroll === 'contain', `inline="${s0.bgInlineOverscroll}"`);
    rec('A4 body + html are locked too',
      s0.bodyInlineOverflow === 'hidden' && s0.htmlInlineOverflow === 'hidden',
      `body="${s0.bodyInlineOverflow}" html="${s0.htmlInlineOverflow}"`);

    rec('B0 the sheet content area is genuinely scrollable', s0.mbRange > 100, `range=${s0.mbRange}px`);
    rec('B0b it carries data-scroll-scope + overscroll contain',
      s0.scrollScopeAttr === 'sheet' && s0.mbOverscroll === 'contain',
      `scope=${s0.scrollScopeAttr} overscroll=${s0.mbOverscroll}`);

    const band = Math.max(20, Math.floor(await page.evaluate(() => {
      const r = document.querySelector('[data-testid="brief-modal"]').getBoundingClientRect();
      return r.top - 8;
    })));
    const bandBefore = await bandShot(page, band);
    const bodyClip = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="brief-modal-body"]').getBoundingClientRect();
      return { x: 0, y: Math.round(r.top + 40), width: 430, height: 80 };
    });
    const sheetBefore = await page.screenshot({ clip: bodyClip });

    await wheelAt(page, 400, '[data-testid="brief-modal-body"]');
    const s1 = await state(page);
    rec('B1 a wheel over the sheet scrolls the SHEET', s1.mbScrollTop > s0.mbScrollTop + 50,
      `sheet scrollTop ${s0.mbScrollTop} → ${s1.mbScrollTop}`);
    rec('B2 the background did NOT move while the sheet scrolled', s1.bgScrollTop === s0.bgScrollTop,
      `bg ${s0.bgScrollTop} → ${s1.bgScrollTop}`);

    const bandAfter = await bandShot(page, band);
    const bandDiff = diffPixels(bandBefore, bandAfter);
    rec('B3 the background band is PIXEL-IDENTICAL while the sheet scrolled', bandDiff === 0,
      `${bandDiff}/${bandBefore.width * bandBefore.height} pixels differ`);
    const sheetAfter = await page.screenshot({ clip: bodyClip });
    const sheetMoved = !Buffer.from(sheetBefore).equals(Buffer.from(sheetAfter));
    rec('B4 control: the sheet region DID change (the scroll really happened)', sheetMoved);

    await page.screenshot({ path: OUT2 + '/D2-daily-modal-scrolled.png' });  // after the wheel
    try {
      const sharp = require('sharp');
      const a = await sharp(OUT2 + '/D1-daily-modal-top.png').resize({ width: 430 }).toBuffer();
      const b = await sharp(OUT2 + '/D2-daily-modal-scrolled.png').resize({ width: 430 }).toBuffer();
      const meta = await sharp(a).metadata();
      await sharp({ create: { width: 880, height: meta.height, channels: 4, background: { r: 20, g: 24, b: 34, alpha: 1 } } })
        .composite([{ input: a, left: 0, top: 0 }, { input: b, left: 450, top: 0 }])
        .png().toFile(OUT2 + '/D6-background-static-proof.png');
      console.log('  📸 side-by-side (left: sheet at top, right: sheet scrolled) → D6-background-static-proof.png');
    } catch (e) { console.log('  (composite skipped:', String(e).slice(0, 60) + ')'); }

    // gesture over the dim, above the sheet (compare against the value taken
    // immediately before the gesture, so unrelated background re-renders can't
    // be mistaken for a pass-through)
    const beforeDim = (await state(page)).bgScrollTop;
    await page.mouse.move(215, Math.max(30, band - 40));
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(700);
    const s2 = await state(page);
    rec('B5 a wheel over the DIMMED AREA does not move the page', s2.bgScrollTop === beforeDim,
      `bg ${beforeDim} → ${s2.bgScrollTop}`);
    const beforeDimSwipe = (await state(page)).bgScrollTop;
    await swipeAt(page, 220, '[data-testid="brief-modal-backdrop"]');
    const s3 = await state(page);
    if (process.env.DBG) console.log('DBG after backdrop swipe:', JSON.stringify(s3), 'contentAreas=', await page.evaluate(() => document.querySelectorAll('.content-area').length), 'scrollY=', await page.evaluate(() => window.scrollY), 'activeEl=', await page.evaluate(() => document.activeElement && document.activeElement.tagName + ':' + (document.activeElement.getAttribute('data-testid') || '')));
    rec('B6 a touch swipe over the DIMMED AREA does not move the page', s3.bgScrollTop === beforeDimSwipe,
      `bg ${beforeDimSwipe} → ${s3.bgScrollTop}`);

    // swipe inside the sheet, from the top
    await page.evaluate(() => { document.querySelector('[data-testid="brief-modal-body"]').scrollTop = 0; });
    await page.waitForTimeout(300);
    const beforeSwipeIn = (await state(page)).bgScrollTop;
    await swipeAt(page, 300, '[data-testid="brief-modal-body"]');
    const s4 = await state(page);
    rec('B7 a touch swipe INSIDE the sheet scrolls the sheet', s4.mbScrollTop > 100,
      `sheet scrollTop ${s4.mbScrollTop}`);
    rec('B8 …and still leaves the background alone', s4.bgScrollTop === beforeSwipeIn,
      `bg ${beforeSwipeIn} → ${s4.bgScrollTop}`);

    // C — close via X releases
    await page.locator('[data-testid="brief-modal-close"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(700);
    const s5 = await state(page);
    rec('C1 X closes the sheet', !s5.open);
    rec('C2 closing RELEASES the inner scroller lock',
      s5.bgInlineOverflow === '' && s5.bgInlineOverscroll === '', `.content-area inline="${s5.bgInlineOverflow}" overscroll="${s5.bgInlineOverscroll}"`);
    rec('C3 closing RELEASES body + html', s5.bodyInlineOverflow === '' && s5.htmlInlineOverflow === '',
      `body="${s5.bodyInlineOverflow}" html="${s5.htmlInlineOverflow}"`);
    rec('C3b the reading position is restored (not clamped to 0)', s5.bgScrollTop > 100,
      `bg after close = ${s5.bgScrollTop}`);
    await wheelAt(page, 300, '.content-area');
    const s6 = await state(page);
    rec('C4 the page scrolls again after close', s6.bgScrollTop > s5.bgScrollTop + 50,
      `bg ${s5.bgScrollTop} → ${s6.bgScrollTop}`);
    await page.screenshot({ path: OUT2 + '/D5-after-close.png' });

    // C5 — Escape path
    await openTeaser(page, 'daily_brief');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const s7 = await state(page);
    rec('C5 Escape closes + releases the lock', !s7.open && s7.bgInlineOverflow === '' && s7.bodyInlineOverflow === '',
      `open=${s7.open} inline="${s7.bgInlineOverflow}"`);

    // C6 — backdrop tap path
    await openTeaser(page, 'daily_brief');
    await page.locator('[data-testid="brief-modal-backdrop"]').first()
      .evaluate((el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await page.waitForTimeout(600);
    const s8 = await state(page);
    rec('C6 backdrop mousedown closes + releases the lock', !s8.open && s8.bgInlineOverflow === '' && s8.bodyInlineOverflow === '',
      `open=${s8.open} inline="${s8.bgInlineOverflow}"`);

    // E — no stuck lock across repeated open/close cycles
    await openTeaser(page, 'daily_brief');
    await page.locator('[data-testid="brief-modal-done"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(500);
    await openTeaser(page, 'weekly_snapshot');
    await page.locator('[data-testid="brief-modal-close"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(600);
    const s9 = await state(page);
    rec('E1 open→close ×2 leaves no stuck lock', !s9.open && s9.bgInlineOverflow === '' && s9.bodyInlineOverflow === '' && s9.htmlInlineOverflow === '',
      `open=${s9.open} ca="${s9.bgInlineOverflow}" body="${s9.bodyInlineOverflow}" html="${s9.htmlInlineOverflow}"`);
    await wheelAt(page, -300, '.content-area');   // at the bottom by now, so scroll UP
    const s10 = await state(page);
    rec('E2 …and the page still scrolls', s10.bgScrollTop < s9.bgScrollTop - 50, `bg ${s9.bgScrollTop} → ${s10.bgScrollTop}`);

    await ctx.close();
  }

  // ══════════ D — Weekly Snapshot ══════════
  {
    const { ctx, page } = await setupChat(browser, { remaining: 40, dailyLimit: 50 });
    await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: LONG_DAILY }));
    await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: LONG_WEEKLY }));
    await gotoInsights(page);
    await page.evaluate(() => { const ca = document.querySelector('.content-area'); if (ca) ca.scrollTop = 260; });
    await page.waitForTimeout(400);

    await openTeaser(page, 'weekly_snapshot');
    const w0 = await state(page);
    rec('D1 weekly teaser opens the SAME sheet with kind=weekly', w0.open && w0.kind === 'weekly', `kind=${w0.kind}`);
    rec('D2 weekly locks the inner scroller', w0.bgInlineOverflow === 'hidden' && w0.bgInlineOverscroll === 'contain',
      `inline="${w0.bgInlineOverflow}" overscroll="${w0.bgInlineOverscroll}"`);
    rec('D3 weekly sheet content is scrollable', w0.mbRange > 100, `range=${w0.mbRange}px`);

    await wheelAt(page, 500, '[data-testid="brief-modal-body"]');
    const w1 = await state(page);
    rec('D4 weekly: the sheet scrolls', w1.mbScrollTop > w0.mbScrollTop + 50, `sheet ${w0.mbScrollTop} → ${w1.mbScrollTop}`);
    rec('D5 weekly: the background stays frozen', w1.bgScrollTop === w0.bgScrollTop, `bg ${w0.bgScrollTop} → ${w1.bgScrollTop}`);
    await page.screenshot({ path: OUT2 + '/D3-weekly-modal-scrolled.png' });

    await page.locator('[data-testid="brief-modal-close"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(700);
    const w2 = await state(page);
    rec('D6 weekly close releases the lock', !w2.open && w2.bgInlineOverflow === '' && w2.bodyInlineOverflow === '',
      `open=${w2.open} inline="${w2.bgInlineOverflow}"`);
    await wheelAt(page, 300, '.content-area');
    const w3 = await state(page);
    rec('D7 weekly: the page scrolls again after close', w3.bgScrollTop > w2.bgScrollTop + 50, `bg ${w2.bgScrollTop} → ${w3.bgScrollTop}`);
    await ctx.close();
  }

  // ══════════ E — dark theme parity ══════════
  {
    const { ctx, page } = await setupChat(browser, { remaining: 40, dailyLimit: 50, theme: 'dark' });
    await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: LONG_DAILY }));
    await gotoInsights(page);
    await openTeaser(page, 'daily_brief');
    const d0 = await state(page);
    rec('E3 dark: lock applied', d0.bgInlineOverflow === 'hidden' && d0.bgInlineOverscroll === 'contain' && d0.bodyInlineOverflow === 'hidden',
      `inline="${d0.bgInlineOverflow}" body="${d0.bodyInlineOverflow}"`);
    await wheelAt(page, 450, '[data-testid="brief-modal-body"]');
    const d1 = await state(page);
    rec('E4 dark: the sheet scrolls and the background does not',
      d1.mbScrollTop > d0.mbScrollTop + 50 && d1.bgScrollTop === d0.bgScrollTop,
      `sheet ${d0.mbScrollTop} → ${d1.mbScrollTop} | bg ${d0.bgScrollTop}`);
    await page.screenshot({ path: OUT2 + '/D4-dark-modal-scrolled.png' });
    await page.locator('[data-testid="brief-modal-close"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(700);
    const d2 = await state(page);
    rec('E5 dark: close releases the lock', !d2.open && d2.bgInlineOverflow === '' && d2.bodyInlineOverflow === '', `inline="${d2.bgInlineOverflow}"`);
    await ctx.close();
  }

  const ok = results.filter((r) => r.pass).length;
  console.log(`\n${ok}/${results.length} checks passed`);
  await browser.close();
  process.exit(ok === results.length ? 0 : 1);
})();
