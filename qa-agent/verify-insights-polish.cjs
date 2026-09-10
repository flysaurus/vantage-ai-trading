// ─────────────────────────────────────────────────────────────
// PART 2b addendum — verification harness for Em's nine additive fixes
//
//   P1  VIEW ONLY badge names the broker (two-weight, same badge)
//   P2  Section order: balance block sits ABOVE the hero deck
//       (health + quick-links stay below it)
//   P3  No italic serif inside hero-deck cards; serif italic survives
//       ONLY on the "Vantage" wordmark + the portfolio balance number
//   P4  Gesture axis: VERTICAL swipe starting on a card scrolls the page;
//       HORIZONTAL swipe navigates the deck (and still fires no action)
//   P5  "Ask Rufus" link treatment is identical on deck cards, the Health
//       card and every quick-link tile (accent, trailing →, no underline)
//   P6  Risk-reduction quick-link carries its "Ask Rufus →" line
//   P7  Ask Rufus bar is more prominent + new placeholder
//
// Same route-mock mechanism as verify-insights.cjs — nothing touches prod.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/insights-polish';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));

const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';
const FIDELITY = '0bf72384-7d1c-4fcb-b5bd-7ca6fe21debc';

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

function rawPositions(rows) {
  return rows.map((r) => ({
    symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock',
    units: r.qty, costBasis: (r.qty || 0) * (r.avg_cost || 0),
    price: r.current_price || r.avg_cost || 0, marketValue: r.market_value || 0,
    dayChange: 0, dayChangePct: 0, openPnl: r.unrealized_pnl || 0, currency: 'USD',
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
const fidelityCash = 1000;
const alpMV = rawPositions(pos.alpaca).reduce((s, p) => s + p.marketValue, 0);
const fidMV = rawPositions(pos.fidelity).reduce((s, p) => s + p.marketValue, 0);

const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: alpMV + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
  { id: `snaptrade:${FIDELITY}`, name: 'ANIKET -YOUTH ACCOUNT', broker: 'Fidelity', brokerageSlug: 'FIDELITY', isDemo: false, tradingEnabled: false, totalValue: fidMV + fidelityCash, buyingPower: null, cash: fidelityCash, environment: 'live', connectionId: FIDELITY },
];

const item = (id, type, title, body, variant, icon, action, extra = {}) => ({
  id, triggerKey: `${type}:${id}`, triggerType: type, title, body, followUp: '',
  variant, icon, meta: { action, ...extra }, action,
  createdAt: new Date(Date.now() - 3600e3).toISOString(), dismissedUntil: null,
});

const CONC_SINGLE = item('mock-conc-single', 'concentration_single', 'Concentration risk',
  'XLF alone is 30.3% of your portfolio. That single position outweighs everything else you own.',
  'warn', '⚖️', 'REBALANCE', { pct: 30.3, symbol: 'XLF', symbols: ['XLF'] });
const EVENT_REVIEW = item('mock-event-review', 'event_impact', 'Earnings this week',
  'NVDA reports Thursday. Your position is large enough that the move will show up in your balance.',
  'accent', '📅', 'REVIEW_POSITION:NVDA', { severity: 'review', symbol: 'NVDA' });
const IDLE = item('mock-idle', 'idle_cash', 'Idle cash',
  "You're holding about $25,000 in cash that isn't working for you.", 'info', '💰', 'INVEST_CASH:25000', { amount: 25000 });
const DRIFT = item('mock-drift', 'portfolio_drift', 'Portfolio drift',
  'Your allocation has drifted 7 points from target.', 'warn', '🧭', 'REBALANCE', {});
const FULL_SET = [CONC_SINGLE, EVENT_REVIEW, IDLE, DRIFT];

const DAILY = { content: 'MARKET: Tech leads the tape while energy lags.\nPORTFOLIO: XLF is carrying the book today.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

async function setup(browser, { accountId, meta, noticed, theme, hasTouch }) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    hasTouch: !!hasTouch,
    isMobile: !!hasTouch,
  });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, acct, th]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      if (th) localStorage.setItem('vantage:theme', th);
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, accountId, theme || '']);

  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });

  await routePath(page, '/api/accounts', (r) => r.fulfill({ json: { accounts } }));
  await routePath(page, '/api/broker/status', (r) => r.fulfill({ json: {
    connected: true, brokerId: 'snaptrade', underlying_broker: meta.brokerageSlug, connectionId: meta.connectionId,
    accountPreview: { id: meta.connectionId, provider: meta.brokerageSlug, name: meta.name },
    environment: meta.environment, trading_enabled: meta.tradingEnabled, holdings_available: true,
  }}));
  await routePath(page, '/api/broker/snaptrade/account', (r) => r.fulfill({ json: meta.accountJson }));
  await routePath(page, '/api/broker/snaptrade/positions', (r) => r.fulfill({ json: meta.accountJson.positions }));
  await routePath(page, '/api/positions/sync', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/sectors', (r) => r.fulfill({ json: { sectors: {} } }));
  await routePath(page, '/api/market/quotes', (r) => r.fulfill({ json: { quotes: {} } }));
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: DAILY }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: WEEKLY }));
  await routePath(page, '/api/ai/noticed', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: { items: noticed } }) : r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/ai/noticed/dismiss', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/ai/chat', (r) => r.fulfill({ json: { ok: true, message: 'mock' } }));
  await routePath(page, '/api/chat', (r) => r.fulfill({ json: { ok: true, message: 'mock', content: 'mock' } }));

  return { ctx, page };
}

const hideDevOverlay = (page) =>
  page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }).catch(() => {});

async function gotoInsights(page) {
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await hideDevOverlay(page);
  await page.locator('[data-testid="hero-deck"], [data-testid="fallback-card"]').first()
    .waitFor({ timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
}

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(900);
  const p = `${OUT}/${name}.png`;
  if (opts.el) {
    await page.locator(opts.el).first().screenshot({ path: p });
  } else if (opts.fullPage) {
    const prev = page.viewportSize() || { width: 430, height: 932 };
    await page.setViewportSize({ width: 430, height: opts.height || 2600 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: p });
    await page.setViewportSize(prev);
    await page.waitForTimeout(400);
  } else {
    await page.screenshot({ path: p });
  }
  console.log('  📸', p);
  return p;
}

/* ── touch swipe via CDP (real touch events, so `touch-action` applies) ── */
async function touchSwipe(page, from, to, steps = 12) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(700);
  await client.detach().catch(() => {});
}

/* tag + read the vertical scroller that actually holds the Insights screen */
const tagScroller = (page) => page.evaluate(() => {
  document.querySelectorAll('[data-qa-scroller]').forEach((n) => n.removeAttribute('data-qa-scroller'));
  const start = document.querySelector('[data-testid="insights-masthead"]') || document.body;
  let n = start;
  while (n && n !== document.body) {
    if (n.scrollHeight > n.clientHeight + 4) {
      n.setAttribute('data-qa-scroller', '1');
      return { kind: 'element', top: n.scrollTop, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight };
    }
    n = n.parentElement;
  }
  document.documentElement.setAttribute('data-qa-scroller', '1');
  return { kind: 'window', top: window.scrollY, scrollHeight: document.documentElement.scrollHeight, clientHeight: window.innerHeight };
});

const readScroller = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-qa-scroller="1"]');
  if (!el) return null;
  return el.tagName === 'HTML' ? window.scrollY : el.scrollTop;
});

(async () => {
  const browser = await chromium.launch();

  /* ═══ P1–P3, P5–P7: Light, full access (Alpaca Paper) ═══ */
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', hasTouch: true,
    });
    await gotoInsights(page);

    /* ── P2: section order ── */
    const order = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const idx = (el) => { const all = [...document.querySelectorAll('*')]; return all.indexOf(el); };
      const mast = q('[data-testid="insights-masthead"]');
      const bal = q('[data-testid="balance-block"]');
      const deck = q('[data-testid="hero-deck"]');
      const heal = q('[data-testid="portfolio-health-card"]');
      const quick = q('[data-testid="quick-links"]');
      return { mast: idx(mast), bal: idx(bal), deck: idx(deck), heal: idx(heal), quick: idx(quick) };
    });
    rec('P2a balance block sits BELOW the masthead/header', order.bal > order.mast, JSON.stringify(order));
    rec('P2b balance block sits ABOVE the hero deck', order.bal < order.deck);
    rec('P2c health card stays BELOW the hero deck', order.heal > order.deck);
    rec('P2d quick-links stay below the health card', order.quick > order.heal);
    await shot(page, 'P2-section-order-viewport');
    await shot(page, 'P2-section-order-full', { fullPage: true });

    /* ── P2: the balance number keeps its serif italic ── */
    const balFont = await page.locator('[data-testid="balance-amount"]').evaluate((el) => {
      const s = getComputedStyle(el); return { family: s.fontFamily, style: s.fontStyle };
    });
    rec('P2e balance number is still serif-italic', /serif/i.test(balFont.family) && balFont.style === 'italic',
      JSON.stringify(balFont));

    /* ── P3: no italic serif inside a deck card ── */
    const cardFonts = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="insight-card"]');
      const pick = (s) => {
        const el = card && card.querySelector(s);
        if (!el) return null;
        const c = getComputedStyle(el);
        return { sel: s, family: c.fontFamily, style: c.fontStyle, weight: c.fontWeight, size: c.fontSize };
      };
      return ['[data-testid="hero-stat"]', '[data-testid="card-sentence"]', '[data-testid="card-caption"]']
        .map(pick).filter(Boolean);
    });
    const isSerif = (fam) => /serif/i.test(fam) && !/sans-serif/i.test(fam);
    const heroStat = cardFonts.find((f) => f.sel.includes('hero-stat'));
    rec('P3a hero stat exists in a deck card', !!heroStat, JSON.stringify(heroStat));
    rec('P3b hero stat is NOT serif', heroStat && !isSerif(heroStat.family), heroStat && heroStat.family);
    rec('P3c hero stat is NOT italic', heroStat && heroStat.style !== 'italic', heroStat && heroStat.style);
    rec('P3d hero stat is bold sans', heroStat && Number(heroStat.weight) >= 700, heroStat && heroStat.weight);
    for (const f of cardFonts) {
      rec(`P3e no serif italic: ${f.sel}`, !isSerif(f.family) && f.style !== 'italic',
        `${f.family} / ${f.style}`);
    }
    await shot(page, 'P3-hero-card-no-italic', { el: '[data-testid="insight-card"]' });

    /* the wordmark KEEPS serif italic */
    const wm = await page.locator('[data-testid="masthead-wordmark"]').evaluate((el) => {
      const s = getComputedStyle(el); return { family: s.fontFamily, style: s.fontStyle };
    });
    rec('P3f "Vantage" wordmark keeps serif italic',
      /Playfair/i.test(wm.family) && /serif/i.test(wm.family) && wm.style === 'italic', JSON.stringify(wm));

    /* ── P5/P6: link treatment ── */
    await page.locator('[data-testid="quick-links"]').scrollIntoViewIfNeeded().catch(() => {});
    const links = await page.evaluate(() => {
      const read = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const c = getComputedStyle(el);
        return { sel, text: (el.textContent || '').trim(), color: c.color, deco: c.textDecorationLine, weight: c.fontWeight };
      };
      return [
        read('[data-testid="card-secondary-link"]'),
        read('[data-testid="health-ask-rufus"]'),
        read('[data-testid="quick-link-rebalance-ask"]'),
        read('[data-testid="quick-link-risk-ask"]'),
        read('[data-testid="quick-link-tax-ask"]'),
        read('[data-testid="quick-link-goals-ask"]'),
      ];
    });
    for (const l of links) {
      rec(`P5 link present: ${l && l.sel}`, !!l, l ? `"${l.text}"` : 'missing');
    }
    for (const l of links.filter(Boolean)) {
      rec(`P5 accent-coloured, no underline: ${l.sel}`,
        l.deco === 'none' && l.color.startsWith('rgb'), `${l.color} / ${l.deco} / ${l.weight}`);
    }
    const arrows = links.filter(Boolean).filter((l) => l.text.endsWith('→')).length;
    rec('P5b every Ask Rufus link carries a trailing arrow', arrows === links.filter(Boolean).length,
      `${arrows}/${links.filter(Boolean).length}`);
    const accentHexes = [...new Set(links.filter(Boolean).map((l) => l.color))];
    rec('P5c canvas links share one accent colour (health + all quick-links)',
      new Set(links.filter(Boolean).slice(1).map((l) => l.color)).size === 1, accentHexes.join(' vs '));
    const risk = links.find((l) => l && l.sel.includes('quick-link-risk-ask'));
    rec('P6 risk-reduction tile has its "Ask Rufus →" line', !!risk && /ask rufus/i.test(risk.text), risk && risk.text);
    rec('P6b risk tile deep-links to the active concentration alert',
      (await page.getAttribute('[data-testid="quick-link-risk"]', 'data-branch')) === 'trigger');
    await shot(page, 'P5-quick-links-ask-lines', { el: '[data-testid="quick-links"]' });
    await shot(page, 'P5-health-card-ask-link', { el: '[data-testid="portfolio-health-card"]' });
    await page.locator('[data-testid="hero-deck"]').scrollIntoViewIfNeeded().catch(() => {});
    await shot(page, 'P5-deck-card-ask-link', { el: '[data-testid="insight-card"]' });

    /* ── P7: Ask Rufus bar ── */
    const bar = await page.locator('[data-testid="ask-rufus-bar"]').evaluate((el) => {
      const c = getComputedStyle(el);
      return {
        height: c.height, borderWidth: c.borderTopWidth, borderStyle: c.borderTopStyle, borderColor: c.borderTopColor,
        bg: c.backgroundColor, shadow: c.boxShadow, radius: c.borderRadius,
        text: (el.textContent || '').trim(),
        placeholderColor: getComputedStyle(el.querySelector('.ask-rufus-placeholder')).color,
        placeholderSize: getComputedStyle(el.querySelector('.ask-rufus-placeholder')).fontSize,
      };
    });
    rec('P7a bar is taller (54px, was 48px)', bar.height === '54px', bar.height);
    rec('P7b bar has a 1px accent border', bar.borderWidth === '1px' && bar.borderStyle === 'solid', `${bar.borderWidth} ${bar.borderStyle} ${bar.borderColor}`);
    rec('P7c bar keeps its shadow', bar.shadow && bar.shadow !== 'none', bar.shadow);
    rec('P7d placeholder copy is "Ask about your portfolio..."', bar.text === 'Ask about your portfolio...', `"${bar.text}"`);
    rec('P7e placeholder colour is darkened from #7c8aa0', bar.placeholderColor !== 'rgb(124, 138, 160)', bar.placeholderColor);
    await shot(page, 'P7-ask-rufus-bar', { el: '[data-testid="ask-rufus-bar"]' });
    await shot(page, 'P7-ask-rufus-bar-context');

    /* ── P4: gesture axis (touch) ── */
    const cardBox = await page.locator('[data-testid="insight-card"]').first().boundingBox();
    await tagScroller(page);
    const beforeScroll = await readScroller(page);
    const beforeIdx = await page.getAttribute('[data-testid="hero-deck"]', 'data-active-index');

    // VERTICAL swipe up, starting on a card → page must scroll
    await touchSwipe(page,
      { x: Math.round(cardBox.x + cardBox.width / 2), y: Math.round(cardBox.y + cardBox.height / 2) },
      { x: Math.round(cardBox.x + cardBox.width / 2), y: Math.round(cardBox.y + cardBox.height / 2) - 320 });
    const afterVScroll = await readScroller(page);
    const afterVIdx = await page.getAttribute('[data-testid="hero-deck"]', 'data-active-index');
    rec('P4a vertical swipe on a card SCROLLS the page', afterVScroll > beforeScroll + 40,
      `scrollTop ${beforeScroll} → ${afterVScroll}`);
    rec('P4b vertical swipe does NOT change the active card', afterVIdx === beforeIdx,
      `${beforeIdx} → ${afterVIdx}`);
    await shot(page, 'P4-after-vertical-swipe');

    // HORIZONTAL swipe → navigates the deck, still no action fires
    await page.locator('[data-testid="hero-deck"]').scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);
    const box2 = await page.locator('[data-testid="insight-card"]').first().boundingBox();
    const vp = page.viewportSize();
    const y2 = Math.min(vp.height - 60, Math.max(60, Math.round(box2.y + box2.height / 2)));
    const deckScrollBefore = await page.locator('[data-testid="hero-deck"]').evaluate((el) => el.scrollLeft);
    await touchSwipe(page,
      { x: Math.round(box2.x + Math.min(box2.width, 300) - 40), y: y2 },
      { x: Math.round(box2.x + 40), y: y2 });
    const deckScrollAfter = await page.locator('[data-testid="hero-deck"]').evaluate((el) => el.scrollLeft);
    const afterHIdx = await page.getAttribute('[data-testid="hero-deck"]', 'data-active-index');
    rec('P4c horizontal swipe STILL navigates the deck',
      deckScrollAfter > deckScrollBefore + 20 || Number(afterHIdx) > Number(beforeIdx),
      `scrollLeft ${deckScrollBefore} → ${deckScrollAfter}; index ${beforeIdx} → ${afterHIdx} (start y=${y2})`);
    await shot(page, 'P4-after-horizontal-swipe');

    await ctx.close();
  }

  /* ═══ P1: read-only Fidelity → broker-aware VIEW ONLY badge ═══ */
  {
    const acctJson = accountResponse(pos.fidelity, fidelityCash, null);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${FIDELITY}`,
      meta: { brokerageSlug: 'FIDELITY', connectionId: FIDELITY, name: 'ANIKET -YOUTH ACCOUNT', environment: 'live', tradingEnabled: false, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', hasTouch: false,
    });
    await gotoInsights(page);

    const badge = await page.locator('[data-testid="view-only-tag"]').evaluate((el) => {
      const c = getComputedStyle(el);
      const kids = [...el.children].map((k) => {
        const kc = getComputedStyle(k);
        return { text: (k.textContent || '').trim(), size: kc.fontSize, weight: kc.fontWeight, color: kc.color };
      });
      return { text: (el.textContent || '').trim(), bg: c.backgroundColor, kids, dataBroker: el.getAttribute('data-broker') };
    }).catch((e) => { rec('P1 badge missing', false, String(e)); return null; });

    if (badge) {
      rec('P1a badge still renders on a read-only account', badge.kids.length > 0);
      rec('P1b badge names the broker (FIDELITY)', /FIDELITY/.test(badge.text), `"${badge.text}"`);
      rec('P1c broker name is the BOLD line', badge.kids[0] && Number(badge.kids[0].weight) >= 700,
        JSON.stringify(badge.kids[0]));
      rec('P1d "view only" is smaller + lighter than the broker name',
        badge.kids[1] && parseFloat(badge.kids[1].size) < parseFloat(badge.kids[0].size) &&
        badge.kids[1].color !== badge.kids[0].color,
        `${badge.kids[0] && badge.kids[0].size} → ${badge.kids[1] && badge.kids[1].size}`);
      rec('P1e same single badge tint behind both lines', !!badge.bg && badge.bg !== 'rgba(0, 0, 0, 0)', badge.bg);
    }
    await shot(page, 'P1-view-only-broker-badge', { el: '[data-testid="insights-header"]' });
    await shot(page, 'P1-view-only-broker-badge-context');

    await ctx.close();
  }

  /* ═══ P1b/P7f: DARK parity of the badge + bar (fresh context, dark theme) ═══ */
  {
    const acctJson = accountResponse(pos.fidelity, fidelityCash, null);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${FIDELITY}`,
      meta: { brokerageSlug: 'FIDELITY', connectionId: FIDELITY, name: 'ANIKET -YOUTH ACCOUNT', environment: 'live', tradingEnabled: false, accountJson: acctJson },
      noticed: FULL_SET, theme: 'dark', hasTouch: false,
    });
    await gotoInsights(page);

    const applied = await page.getAttribute('html', 'data-theme');
    rec('P1f dark theme applied', applied === 'dark', `data-theme=${applied}`);

    const darkBadge = await page.locator('[data-testid="view-only-tag"]').evaluate((el) => {
      const kids = [...el.children].map((k) => {
        const kc = getComputedStyle(k);
        return { text: (k.textContent || '').trim(), color: kc.color };
      });
      return { text: (el.textContent || '').trim(), bg: getComputedStyle(el).backgroundColor, kids };
    }).catch(() => null);
    rec('P1g dark: badge names the broker too', !!darkBadge && /FIDELITY/.test(darkBadge.text), darkBadge && darkBadge.text);
    rec('P1h dark: badge keeps the amber tint', !!darkBadge && darkBadge.bg.startsWith('rgba(217, 169, 74'), darkBadge && darkBadge.bg);
    await shot(page, 'P1-view-only-broker-badge-dark', { el: '[data-testid="insights-header"]' });
    await shot(page, 'P1-dark-full', { fullPage: true });

    const darkBar = await page.locator('[data-testid="ask-rufus-bar"]').evaluate((el) => {
      const c = getComputedStyle(el);
      return { borderColor: c.borderTopColor, placeholder: getComputedStyle(el.querySelector('.ask-rufus-placeholder')).color };
    }).catch(() => null);
    rec('P7f dark: bar border uses the dark accent (cyan)', !!darkBar && darkBar.borderColor === 'rgb(95, 216, 222)',
      darkBar && `border ${darkBar.borderColor} · placeholder ${darkBar.placeholder}`);
    await shot(page, 'P7-ask-rufus-bar-dark', { el: '[data-testid="ask-rufus-bar"]' });

    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  ❌ ${f.name} — ${f.detail}`);
  }
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log('SHOTS:', fs.readdirSync(OUT).join(', '));
  process.exit(failed.length ? 1 : 0);
})();
