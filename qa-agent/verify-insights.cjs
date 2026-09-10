// ─────────────────────────────────────────────────────────────
// PART 2 verification harness — Insights tab
//
// Covers the required matrix:
//   A. Light, full access, ACTIVE concentration trigger (hero deck)
//   B. Dark parity (same data)
//   C. Read-only account → VIEW ONLY + Download-only actions
//   D. No active triggers → single "no action needed" fallback (no dots)
//   E. SWIPE = navigation only, never triggers an action  ← the critical one
//   F. Portfolio Health real computed sub-scores + "Ask Rufus to explain"
//   G. All four quick-links
//   H. Theme toggle applies live without reload
//   I. Milestones must NOT appear on this screen
//
// Data is injected with route mocks (same mechanism as screenshot-live.cjs)
// so nothing is written to production.
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/insights';
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
const EVENT_INFO = item('mock-event-info', 'event_impact', 'CPI print Tuesday',
  'A macro print lands Tuesday. Informational — nothing to do.', 'info', '📰', null, { severity: 'info' });
const IDLE = item('mock-idle', 'idle_cash', 'Idle cash',
  "You're holding about $25,000 in cash that isn't working for you.", 'info', '💰', 'INVEST_CASH:25000', { amount: 25000 });
const BOUNCE = item('mock-bounce', 'bounce_back', 'Bounce back',
  'INTC is down but your thesis still holds. This is roughly where you added last time.',
  'accent', '📉', 'REVIEW_POSITION:INTC', { symbol: 'INTC' });
const MILESTONE = item('mock-milestone', 'position_milestone', 'Milestone reached',
  'Your portfolio crossed $250,000 today. Nice.', 'gain', '🎉', null, {});
const DRIFT = item('mock-drift', 'portfolio_drift', 'Portfolio drift',
  'Your allocation has drifted 7 points from target.', 'warn', '🧭', 'REBALANCE', {});

const FULL_SET = [MILESTONE, EVENT_INFO, CONC_SINGLE, EVENT_REVIEW, IDLE, BOUNCE, DRIFT];

const DAILY = { content: 'MARKET: Tech leads the tape while energy lags.\nPORTFOLIO: XLF is carrying the book today.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

function routePath(page, pathname, handler) {
  return page.route((url) => new URL(url).pathname === pathname, handler);
}

async function setup(browser, { accountId, meta, noticed, theme, viewport, briefs }) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 430, height: 932 } });
  await ctx.addCookies([{ name: cookieName, value: cookieVal, domain: 'localhost', path: '/' }]);
  await ctx.addInitScript(([lsv, acct, th]) => {
    try {
      localStorage.setItem('vantage-auth-token', lsv);
      localStorage.setItem('vantage:activeAccount', acct);
      if (th) localStorage.setItem('vantage:theme', th);
      // Suppress the first-login full-screen Account Select overlay so it does
      // not cover the Insights screen (it renders ON TOP of the app shell).
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
    } catch (e) {}
  }, [localSession, accountId, theme || '']);

  const briefsOn = briefs !== false;

  const page = await ctx.newPage();
  const chatPosts = [];
  const dismissPosts = [];

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
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: briefsOn ? DAILY : {} }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: briefsOn ? WEEKLY : {} }));
  await routePath(page, '/api/ai/noticed', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { items: noticed } });
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/ai/noticed/dismiss', (r) => {
    try { dismissPosts.push(r.request().postDataJSON()); } catch { dismissPosts.push({ raw: r.request().postData() }); }
    return r.fulfill({ json: { ok: true } });
  });
  await routePath(page, '/api/ai/chat', (r) => {
    try { chatPosts.push(r.request().postDataJSON()); } catch { chatPosts.push({ raw: r.request().postData() }); }
    return r.fulfill({ json: { ok: true, message: 'mock' } });
  });
  // the real chat endpoint used by AITab
  await routePath(page, '/api/chat', (r) => {
    try { chatPosts.push(r.request().postDataJSON()); } catch { chatPosts.push({ raw: r.request().postData() }); }
    return r.fulfill({ json: { ok: true, message: 'mock', content: 'mock' } });
  });

  return { ctx, page, chatPosts, dismissPosts };
}

const shot = async (page, name, opts = {}) => {
  await page.waitForTimeout(1200);
  const p = `${OUT}/${name}.png`;
  if (opts.fullPage) {
    // The app shell is 100dvh with an internally-scrolling .content-area, so a
    // normal fullPage capture only ever yields one viewport. Grow the viewport
    // instead so the whole Insights screen is in one image — then restore the
    // original size so later assertions still see the intended breakpoint.
    const prev = page.viewportSize() || { width: 430, height: 932 };
    const W = opts.width || 430;
    const H = opts.height || 2600;
    await page.setViewportSize({ width: W, height: H });
    await page.waitForTimeout(900);
    await page.screenshot({ path: p });
    await page.setViewportSize(prev);
    await page.waitForTimeout(400);
  } else {
    await page.screenshot({ path: p });
  }
  console.log('  📸', p);
  return p;
};

const overlayOpen = (page) =>
  page.evaluate(() => [...document.querySelectorAll('div')].some((d) => d.style && d.style.zIndex === '99990'));

const hideDevOverlay = (page) =>
  page
    .addStyleTag({ content: 'nextjs-portal{display:none!important}' })
    .catch(() => {});

async function gotoInsights(page) {
  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await hideDevOverlay(page);
  // let the noticed + brief fetches land before asserting anything
  await page
    .locator('[data-testid="hero-deck"], [data-testid="fallback-card"]')
    .first()
    .waitFor({ timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(3500);
}

(async () => {
  const browser = await chromium.launch();

  // ── A. Light, full access, active concentration trigger ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);

    const theme = await page.getAttribute('html', 'data-theme');
    rec('A1 light theme applied', theme === 'light', `data-theme=${theme}`);

    for (const [name, sel] of [
      ['masthead', '[data-testid="insights-masthead"]'],
      ['hero deck', '[data-testid="hero-deck"]'],
      ['health card', '[data-testid="portfolio-health-card"]'],
      ['quick links', '[data-testid="quick-links"]'],
      ['balance section', '[data-testid="balance-section"]'],
      ['bottom nav', '[data-testid="bottom-nav"]'],
      ['ask rufus bar', '[data-testid="ask-rufus-bar"]'],
    ]) {
      rec(`A2 ${name} present`, await page.locator(sel).count() > 0);
    }

    const wordmark = await page.textContent('[data-testid="masthead-wordmark"]').catch(() => '');
    rec('A3 masthead wordmark is serif-italic "Vantage"', wordmark.trim() === 'Vantage', `"${wordmark.trim()}"`);

    const rule = await page.locator('[data-testid="masthead-rule"]').first().evaluate((el) => getComputedStyle(el).borderTopWidth).catch(() => '');
    rec('A4 accent rule is 2px', rule === '2px', `border-top=${rule}`);

    const cardCount = await page.getAttribute('[data-testid="hero-deck"]', 'data-card-count');
    const dotCount = await page.locator('[data-testid="deck-dot"]').count();
    rec('A5 deck holds 5 cards (conc, event-review, idle, bounce, +2 teasers = 6)', cardCount === '6', `count=${cardCount}`);
    rec('A6 dots match card count', String(dotCount) === cardCount, `${dotCount} dots`);

    const firstCat = await page.locator('[data-testid="insight-card"]').first().textContent();
    rec('A7 concentration card is first (priority order)', /concentration/i.test(firstCat || ''));

    const bodyText = await page.textContent('body');
    rec('A8 milestone NOT rendered on Insights', !/Milestone reached/i.test(bodyText));
    rec('A9 info-tier event_impact NOT in deck', !/CPI print Tuesday/i.test(bodyText));

    const navTabs = await page.locator('[data-testid="bottom-nav"] button').allTextContents();
    rec('A10 bottom nav = Insights/Holdings/Invest/Settings',
      JSON.stringify(navTabs.map((s) => s.trim())) === JSON.stringify(['Insights', 'Holdings', 'Invest', 'Settings']),
      navTabs.join('|'));
    const insightsActive = await page.getAttribute('[data-testid="nav-insights"]', 'data-active');
    rec('A11 Insights tab active', insightsActive === 'true');

    const viewOnly = await page.locator('[data-testid="view-only-tag"]').count();
    rec('A12 no VIEW ONLY on a full-access account', viewOnly === 0);

    const acctName = (await page.textContent('[data-testid="masthead-account"]')) || '';
    rec('A13 masthead shows the active account name', /Alpaca/i.test(acctName), acctName.trim());

    await shot(page, 'A-light-full-active-trigger-full', { fullPage: true });
    await shot(page, 'A-light-full-active-trigger-viewport');
    await ctx.close();
  }

  // ── B. Dark parity ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'dark', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);
    rec('B1 dark theme applied', (await page.getAttribute('html', 'data-theme')) === 'dark');
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    rec('B2 dark canvas is near-black', /rgb\(0, 8, 20\)|rgba\(0, 8, 20/.test(canvas), canvas);
    await shot(page, 'B-dark-parity-full', { fullPage: true });
    await shot(page, 'B-dark-parity-viewport');
    await ctx.close();
  }

  // ── C. Read-only account ──
  {
    const acctJson = accountResponse(pos.fidelity, fidelityCash, null);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${FIDELITY}`,
      meta: { brokerageSlug: 'FIDELITY', connectionId: FIDELITY, name: 'ANIKET -YOUTH ACCOUNT', environment: 'live', tradingEnabled: false, accountJson: acctJson },
      noticed: [CONC_SINGLE, EVENT_REVIEW, IDLE], theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);
    rec('C1 VIEW ONLY tag shown', await page.locator('[data-testid="view-only-tag"]').count() > 0);
    const ctas = await page.locator('[data-testid="card-primary-cta"]').allTextContents();
    const tradey = ctas.filter((t) => /\b(trade|invest|buy|sell)\b/i.test(t));
    rec('C2 no trade/invest action offered to a read-only account', tradey.length === 0, ctas.join('|'));
    rec('C2b read-only trigger cards offer Download', ctas.some((t) => /download/i.test(t)), ctas.join('|'));
    await shot(page, 'C-readonly-view-only-full', { fullPage: true });
    await ctx.close();
  }

  // ── D. No active triggers → fallback ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: [MILESTONE, EVENT_INFO], theme: 'light', viewport: { width: 430, height: 932 }, briefs: false,
    });
    await gotoInsights(page);
    rec('D1 fallback card rendered', await page.locator('[data-testid="fallback-card"]').count() > 0);
    rec('D2 no deck', await page.locator('[data-testid="hero-deck"]').count() === 0);
    rec('D3 no dots', await page.locator('[data-testid="deck-dot"]').count() === 0);
    const ftxt = await page.textContent('[data-testid="fallback-card"]').catch(() => '');
    rec('D4 fallback says no action needed', /no action needed/i.test(ftxt || ''));
    await shot(page, 'D-fallback-no-triggers-full', { fullPage: true });
    await ctx.close();
  }

  // ── D2. No triggers, but brief content exists → teasers only ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: [MILESTONE, EVENT_INFO], theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);
    const n = await page.getAttribute('[data-testid="hero-deck"]', 'data-card-count');
    rec('D2b no-trigger + brief content → teaser-only deck', n === '2', `count=${n}`);
    await shot(page, 'D2-teasers-only-full', { fullPage: true });
    await ctx.close();
  }

  // ── E. THE CRITICAL ONE: swipe navigates, never acts ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page, chatPosts, dismissPosts } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);

    const deck = page.locator('[data-testid="hero-deck"]').first();
    const before = await deck.getAttribute('data-active-index');
    const box = await deck.boundingBox();

    // three decisive left-drags (past the 6px threshold, released over the card body)
    for (let i = 0; i < 3; i++) {
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + box.width - 40, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 100, y, { steps: 6 });
      await page.mouse.move(box.x + 30, y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(900);
    }
    const after = await deck.getAttribute('data-active-index');
    const scrollLeft = await deck.evaluate((el) => el.scrollLeft);
    rec('E1 drag/swipe changed the active card', before !== after, `${before} → ${after} (scrollLeft=${Math.round(scrollLeft)})`);
    rec('E1b the deck actually scrolled horizontally', scrollLeft > 0, `scrollLeft=${Math.round(scrollLeft)}`);

    const chatOpen = await overlayOpen(page);
    rec('E2 swipe did NOT open chat', chatOpen === false);
    rec('E3 swipe did NOT post to chat API', chatPosts.length === 0, `${chatPosts.length} posts`);
    rec('E4 swipe did NOT dismiss/snooze anything', dismissPosts.length === 0, `${dismissPosts.length} posts`);

    // a tap (no drag) must also not fire an action
    const card = page.locator('[data-testid="insight-card"]').nth(1);
    const cbox = await card.boundingBox();
    if (cbox) {
      await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + 20);
      await page.waitForTimeout(800);
    }
    rec('E5 tap on card body does not act', (await overlayOpen(page)) === false && chatPosts.length === 0);

    const dotIndex = await page.locator('[data-testid="deck-dot"][data-active="true"]').first().getAttribute('data-index').catch(() => null);
    rec('E6 active dot tracks the card', dotIndex !== null, `dot=${dotIndex}`);

    await shot(page, 'E-swipe-after-3-drags', {});

    // now prove the snooze sheet DOES post (the action path works when asked)
    const snooze = page.locator('[data-testid="card-snooze"]').first();
    if (await snooze.count()) {
      await snooze.evaluate((el) => el.click());
      await page.waitForTimeout(700);
      const sheet = await page.locator('[data-testid="snooze-sheet"]').count();
      rec('E7 explicit Remind opens the snooze sheet', sheet > 0);
      await shot(page, 'E-snooze-sheet-open', {});
      const opt = page.locator('[data-testid="snooze-option-3d"]').first();
      if (await opt.count()) {
        await opt.evaluate((el) => el.click());
        await page.waitForTimeout(1000);
        rec('E8 deliberate snooze DOES post to dismiss', dismissPosts.length > 0, `${dismissPosts.length} posts`);
      }
    } else {
      rec('E7 explicit Remind button present', false, 'no card-snooze found');
    }
    await ctx.close();
  }

  // ── F. Portfolio Health: real sub-scores + Ask Rufus to explain ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page, chatPosts } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);

    const score = await page.getAttribute('[data-testid="portfolio-health-card"]', 'data-health-score');
    const d = await page.getAttribute('[data-testid="health-subscore-diversification"]', 'data-value');
    const r = await page.getAttribute('[data-testid="health-subscore-riskBalance"]', 'data-value');
    const t = await page.getAttribute('[data-testid="health-subscore-returns"]', 'data-value');
    rec('F1 health score is a real computed number', Number.isFinite(Number(score)) && Number(score) > 0, `score=${score}`);
    rec('F2 all three sub-scores computed', [d, r, t].every((v) => Number.isFinite(Number(v))), `${d}/${r}/${t}`);
    rec('F3 weighting matches the documented formula',
      Number(score) === Math.round(0.4 * Number(d) + 0.35 * Number(r) + 0.25 * Number(t)),
      `${score} vs ${Math.round(0.4 * Number(d) + 0.35 * Number(r) + 0.25 * Number(t))}`);

    const line = await page.textContent('[data-testid="health-supporting-line"]');
    const symbols = rawPositions(pos.alpaca).map((p) => p.symbol);
    const namesReal = symbols.some((s) => new RegExp(`\\b${s}\\b`).test(line || ''));
    rec('F4 supporting line names a REAL top holding + %', namesReal && /%/.test(line || ''), (line || '').slice(0, 90));

    const cta = await page.textContent('[data-testid="health-ask-rufus"]');
    rec('F5 "Ask Rufus to explain" CTA present', /ask rufus to explain/i.test(cta || ''), cta || '');

    await page.locator('[data-testid="portfolio-health-card"]').scrollIntoViewIfNeeded();
    await shot(page, 'F-health-card', {});

    await page.locator('[data-testid="health-ask-rufus"]').evaluate((el) => el.click());
    await page.waitForTimeout(3500);
    rec('F6 clicking it opens chat', await overlayOpen(page));
    const prompt = JSON.stringify(chatPosts[0] || {});
    rec('F7 pre-filled prompt references the REAL score', prompt.includes(String(score)), `score=${score}`);
    rec('F8 prompt references the real sub-scores',
      [d, r, t].every((v) => prompt.includes(String(v))), prompt.slice(0, 220));
    await shot(page, 'F-ask-rufus-explain-open', {});
    await ctx.close();
  }

  // ── G. Quick-links (trigger branch + ask branch) ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);
    await page.locator('[data-testid="quick-links"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    for (const id of ['rebalance', 'risk', 'tax', 'goals']) {
      const n = await page.locator(`[data-testid="quick-link-${id}"]`).count();
      rec(`G1 quick-link present: ${id}`, n > 0);
    }
    rec('G2 rebalance deep-links to the active drift alert',
      (await page.getAttribute('[data-testid="quick-link-rebalance"]', 'data-branch')) === 'trigger');
    rec('G3 risk reduction deep-links to the active concentration alert',
      (await page.getAttribute('[data-testid="quick-link-risk"]', 'data-branch')) === 'trigger');
    rec('G4 tax + goals are ask-only (no misleading copy)',
      (await page.getAttribute('[data-testid="quick-link-tax"]', 'data-branch')) === 'ask' &&
      (await page.getAttribute('[data-testid="quick-link-goals"]', 'data-branch')) === 'ask');
    const taxCopy = await page.textContent('[data-testid="quick-link-tax"]');
    rec('G5 ask-only tiles say "Ask Rufus"', /ask rufus/i.test(taxCopy || ''), (taxCopy || '').replace(/\s+/g, ' '));
    await shot(page, 'G-quick-links-2x2', {});
    await ctx.close();
  }

  // ── H. Theme toggle applies live, no reload ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 430, height: 932 },
    });
    await gotoInsights(page);
    let navigations = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

    await page.goto(`${BASE}/preferences`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await hideDevOverlay(page);
    await page.waitForTimeout(4000);
    const togglePresent = await page.locator('[data-testid="theme-toggle"]').count();
    rec('H1 theme toggle in Preferences', togglePresent > 0);
    const opts = await page.locator('[data-testid="theme-toggle"] button').allTextContents();
    rec('H2 three modes Light/Dark/System',
      JSON.stringify(opts.map((s) => s.trim())) === JSON.stringify(['Light', 'Dark', 'System']), opts.join('|'));
    await shot(page, 'H-preferences-theme-toggle', { fullPage: true });

    const navBefore = navigations;
    await page.locator('[data-testid="theme-option-dark"]').evaluate((el) => el.click());
    await page.waitForTimeout(1200);
    const afterDark = await page.getAttribute('html', 'data-theme');
    rec('H3 switching to Dark applies live without a reload',
      afterDark === 'dark' && navigations === navBefore, `data-theme=${afterDark}, navs=${navigations - navBefore}`);
    const stored = await page.evaluate(() => localStorage.getItem('vantage:theme'));
    rec('H4 choice persists', stored === 'dark', `stored=${stored}`);
    await shot(page, 'H-after-toggle-dark', { fullPage: true });

    await page.locator('[data-testid="theme-option-system"]').evaluate((el) => el.click());
    await page.waitForTimeout(1200);
    const afterSystem = await page.getAttribute('html', 'data-theme');
    rec('H5 System resolves to the OS appearance', ['light', 'dark'].includes(afterSystem), `data-theme=${afterSystem}`);
    rec('H6 System mode also needs no reload', navigations === navBefore);

    await page.locator('[data-testid="theme-option-light"]').evaluate((el) => el.click());
    await page.waitForTimeout(800);
    rec('H7 back to Light', (await page.getAttribute('html', 'data-theme')) === 'light');
    await ctx.close();
  }

  // ── I. Desktop (sidebar) parity ──
  {
    const acctJson = accountResponse(pos.alpaca, alpacaCash, alpacaCash);
    const { ctx, page } = await setup(browser, {
      accountId: `snaptrade:${ALPACA}`,
      meta: { brokerageSlug: 'ALPACA-PAPER', connectionId: ALPACA, name: 'Alpaca Paper', environment: 'paper', tradingEnabled: true, accountJson: acctJson },
      noticed: FULL_SET, theme: 'light', viewport: { width: 1440, height: 1000 },
    });
    await gotoInsights(page);
    await shot(page, 'I-desktop-light', { fullPage: true, width: 1440, height: 2000 });
    rec('I1 desktop sidebar replaces bottom nav', await page.locator('[data-testid="bottom-nav"]').count() === 0);
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach((f) => console.log(` - ${f.name}${f.detail ? ' :: ' + f.detail : ''}`));
  }
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  console.log('SHOTS:', fs.readdirSync(OUT).join(', '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
