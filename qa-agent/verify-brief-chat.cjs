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

(async () => {
  const browser = await chromium.launch();

  // ══════════ PART A ══════════

  // ── A1/A2/A6 — Daily Brief teaser → modal with real content, tab preserved ──
  {
    const { ctx, page } = await setupChat(browser, { remaining: 40, dailyLimit: 50 });
    await gotoInsights(page);

    const beforeTab = await page.getAttribute('[data-testid="nav-insights"]', 'data-active');

    await clickTeaser(page, 'daily_brief');
    await page.locator('[data-testid="brief-modal"]').waitFor({ timeout: 15000 }).catch(() => {});
    const modalCount = await page.locator('[data-testid="brief-modal"]').count();
    rec('A1 daily teaser opens the brief MODAL (not Holdings, not chat)', modalCount === 1, `modals=${modalCount}`);

    const kind = await page.getAttribute('[data-testid="brief-modal"]', 'data-brief-kind').catch(() => '');
    rec('A2 modal is the daily brief', kind === 'daily', `kind=${kind}`);

    const title = (await page.textContent('[data-testid="brief-modal-title"]').catch(() => '')) || '';
    rec('A3 modal title names the Daily Brief', /daily brief/i.test(title), title.trim());

    for (const tag of ['MARKET', 'PORTFOLIO', 'WATCH', 'EARNINGS']) {
      const t = (await page.textContent(`[data-testid="brief-section-${tag}"]`).catch(() => '')) || '';
      rec(`A4 ${tag} section rendered with real content`, t.includes(tag) && t.length > tag.length + 15, t.slice(0, 70));
    }

    const body = (await page.textContent('[data-testid="brief-modal-body"]').catch(() => '')) || '';
    rec('A5 modal body carries the actual brief text', body.includes('Tech leads the tape') && body.includes('INTC reports next week'));
    rec('A6 chat did NOT open when the teaser was tapped', (await page.locator('[data-testid="chat-input"]').count()) === 0);

    // the Insights screen must still be the active tab underneath
    const afterTab = await page.getAttribute('[data-testid="nav-insights"]', 'data-active');
    const holdingsTab = await page.getAttribute('[data-testid="nav-portfolio"]', 'data-active').catch(() => 'n/a');
    rec('A7 Insights tab stays active (never navigates to Holdings)',
      afterTab === 'true' && holdingsTab !== 'true', `insights=${afterTab} holdings=${holdingsTab} (was ${beforeTab})`);

    await shot(page, 'A-daily-brief-modal');

    // ── A8 close button dismisses, back to Insights ──
    await page.locator('[data-testid="brief-modal-close"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(700);
    rec('A8 close button dismisses the modal', (await page.locator('[data-testid="brief-modal"]').count()) === 0);
    rec('A8b Insights still rendered after dismiss', (await page.locator('[data-testid="hero-deck"]').count()) > 0);

    // ── A9 Escape dismisses ──
    await clickTeaser(page, 'daily_brief');
    await page.locator('[data-testid="brief-modal"]').waitFor({ timeout: 10000 }).catch(() => {});
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    rec('A9 Escape dismisses the modal', (await page.locator('[data-testid="brief-modal"]').count()) === 0);

    // ── A10 backdrop dismisses ──
    await clickTeaser(page, 'daily_brief');
    await page.locator('[data-testid="brief-modal"]').waitFor({ timeout: 10000 }).catch(() => {});
    await page.locator('[data-testid="brief-modal-backdrop"]').first().evaluate((el) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await page.waitForTimeout(600);
    rec('A10 backdrop click dismisses the modal', (await page.locator('[data-testid="brief-modal"]').count()) === 0);

    await ctx.close();
  }

  // ── A11 — Weekly Snapshot teaser → same modal, weekly body ──
  {
    const { ctx, page, chatPosts } = await setupChat(browser, { remaining: 40, dailyLimit: 50 });
    await gotoInsights(page);

    await clickTeaser(page, 'weekly_snapshot');
    await page.locator('[data-testid="brief-modal"]').waitFor({ timeout: 15000 }).catch(() => {});
    const kind = await page.getAttribute('[data-testid="brief-modal"]', 'data-brief-kind').catch(() => '');
    rec('A11 weekly teaser opens the modal in weekly mode', kind === 'weekly', `kind=${kind}`);

    const body = (await page.textContent('[data-testid="brief-modal-body"]').catch(() => '')) || '';
    rec('A12 weekly modal shows the real snapshot body', body.includes('Concentration tightened again this week') && /Risk Level/i.test(body));
    rec('A13 weekly subtitle surfaces health/risk', /Health 7\/10/.test(body) || /Risk MODERATE/.test(await page.textContent('[data-testid="brief-modal"]').catch(() => '')));

    await shot(page, 'A-weekly-snapshot-modal');

    // ── A14 "Ask Rufus about this" → chat opens grounded in THIS brief ──
    await page.locator('[data-testid="brief-modal-ask-rufus"]').first().evaluate((el) => el.click());
    await page.locator('[data-testid="chat-input"]').waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3500);

    rec('A14 modal closed by "Ask Rufus about this"', (await page.locator('[data-testid="brief-modal"]').count()) === 0);
    const chatOpen = (await page.locator('[data-testid="chat-input"]').count()) > 0;
    rec('A15 chat opened', chatOpen);

    const thread = (await page.textContent('body')) || '';
    rec('A16 the brief text is visibly carried into the chat', thread.includes('Concentration tightened again this week'));

    const posted = await page.evaluate(() => (window.__chatPosts || []).length).catch(() => 0);
    rec('A17 (info) posted chat requests', true, `n=${posted}`);
    const grounded = chatPosts.some((p) => p && JSON.stringify(p).includes('Concentration tightened again this week'));
    rec('A17b the brief content is in the request payload sent to the model', grounded,
      `posts=${chatPosts.length}`);
    await shot(page, 'A-ask-rufus-about-this-chat', { fullPage: true });

    await ctx.close();
  }

  // ══════════ PART B ══════════

  // ── B1/B2/B4/B5 — toggle gone, counter gone, Go deeper works ──
  {
    const reply = 'XLF is 30.3% of your book — that is the single largest line and it is more than double your next holding. Trimming toward a 20% cap would cut portfolio volatility without changing your thesis.';
    const deeper = 'XLF is 30.3% of your book, more than double your next holding. Running this through the sector lens: financials carry a 1.28 beta to the S&P, so that single line contributes roughly 38% of your daily portfolio variance while representing 30% of the capital. Historically your own tolerance band has been a 20% single-name cap. Two concrete paths: (1) trim 10 points of XLF and redeploy half into your underweight healthcare sleeve and half into cash, holding beta roughly flat while cutting the variance contribution by about a third; (2) stage the trim over three weeks to avoid one-day execution risk, accepting slightly slower variance reduction. The first path is the higher-conviction one given your current cash yield.';
    const { ctx, page, chatPosts } = await setupChat(browser, {
      remaining: 40, dailyLimit: 50, replyText: reply, threadReplyText: deeper,
    });
    await gotoInsights(page);
    await openChat(page);

    // B1 — no mode toggle anywhere in the chat chrome
    const deepBtn = await page.locator('button', { hasText: 'Deep Dive' }).count();
    const pressed = await page.locator('[aria-pressed]').count();
    rec('B1 no Chat/Deep Dive toggle in the chat', deepBtn === 0, `deepDive buttons=${deepBtn}`);
    rec('B1b no leftover segmented control', pressed === 0, `aria-pressed elements=${pressed}`);

    // B2 — no persistent counter with plenty of quota
    const chrome = (await page.textContent('body')) || '';
    rec('B2 no persistent "N messages left" counter', !/\d+\s+messages?\s+left/i.test(chrome));
    rec('B2b low-limit warning hidden with 40 remaining', (await page.locator('[data-testid="chat-low-limit-warning"]').count()) === 0);

    // B4 — send a message, then Go deeper
    await ask(page, 'Is my XLF position too big?');
    await page.waitForTimeout(2500);
    const threadAfterFirst = (await page.textContent('body')) || '';
    rec('B4 prep: first answer rendered', threadAfterFirst.includes('30.3% of your book — that is the single largest line'));

    const goDeep = page.locator('[data-testid="go-deeper"]').first();
    rec('B4a "Go deeper" button is present under the response', (await goDeep.count()) > 0);
    await shot(page, 'B-go-deeper-button');

    const bubbleCountBefore = await page.locator('[data-testid="go-deeper"]').count();
    await goDeep.evaluate((el) => el.click());
    await page.waitForTimeout(5000);

    const deepPost = chatPosts.find((p) => p && p.mode === 'deep');
    rec('B4b "Go deeper" reran on the deep tier', !!deepPost, `modes=${chatPosts.map((p) => p && p.mode).join(',')}`);
    rec('B4c the deep rerun re-asked the ORIGINAL question',
      !!deepPost && /XLF position too big/i.test(JSON.stringify(deepPost.messages || [])),
      deepPost ? String(JSON.stringify((deepPost.messages || []).slice(-2))).slice(0, 160) : 'no deep post');

    const threadAfterDeep = (await page.textContent('body')) || '';
    rec('B4d the answer is now MORE THOROUGH (not a no-op)', threadAfterDeep.includes('contributes roughly 38% of your daily portfolio variance'));
    rec('B4e the deeper answer replaced the shorter one in place',
      threadAfterDeep.includes('higher-conviction'), threadAfterDeep.length > 0 ? `len=${threadAfterDeep.length}` : '');
    const bubbleCountAfter = await page.locator('[data-testid="go-deeper"]').count();
    rec('B4f no extra message bubble was appended (still exactly one Go deeper button)',
      bubbleCountAfter === bubbleCountBefore && bubbleCountAfter === 1, `${bubbleCountBefore} → ${bubbleCountAfter}`);
    rec('B4g response is tagged DEEP RESEARCH', (await page.locator('[data-testid="deep-badge"]').count()) === 1);
    await shot(page, 'B-after-go-deeper', { fullPage: true });

    // ── B5 — collapse returns to the originating tab (Insights) ──
    await page.locator('button[aria-label="Close chat"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(800);
    const insightsActive = await page.getAttribute('[data-testid="nav-insights"]', 'data-active');
    rec('B5 chat collapsed back to Insights', insightsActive === 'true' && (await page.locator('[data-testid="chat-input"]').count()) === 0);

    // ── B5b — same from Holdings (nav id is `nav-portfolio`) ──
    await page.locator('[data-testid="nav-portfolio"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(2500);
    const onHoldings = await page.getAttribute('[data-testid="nav-portfolio"]', 'data-active');
    rec('B5b prep: switched to Holdings', onHoldings === 'true', `holdings=${onHoldings}`);
    await openChat(page);
    await page.locator('button[aria-label="Close chat"]').first().evaluate((el) => el.click());
    await page.waitForTimeout(800);
    const backOnHoldings = await page.getAttribute('[data-testid="nav-portfolio"]', 'data-active');
    const insightsAfter = await page.getAttribute('[data-testid="nav-insights"]', 'data-active');
    rec('B5c collapsing from Holdings returns to Holdings (not Insights)',
      backOnHoldings === 'true' && insightsAfter !== 'true', `holdings=${backOnHoldings} insights=${insightsAfter}`);

    await ctx.close();
  }

  // ── B3 — low-limit warning appears only when close ──
  {
    // dailyLimit 50 → 10% = 5 → threshold min(5, 5) = 5.  6 remaining = silent, 5 = warn.
    for (const [remaining, shouldWarn] of [[6, false], [5, true], [2, true]]) {
      const { ctx, page } = await setupChat(browser, {
        remaining, dailyLimit: 50,
        replyText: 'Concentration is the main thing to watch right now — your largest line is well above the rest.',
      });
      await gotoInsights(page);
      await openChat(page);
      const warnCount = await page.locator('[data-testid="chat-low-limit-warning"]').count();
      const warnText = warnCount ? ((await page.textContent('[data-testid="chat-low-limit-warning"]')) || '').trim() : '';
      rec(`B3 remaining=${remaining} (limit 50, threshold 5) → warning ${shouldWarn ? 'shown' : 'hidden'}`,
        (warnCount > 0) === shouldWarn, warnCount ? warnText : 'no warning');
      if (shouldWarn && remaining === 5) await shot(page, 'B-low-limit-warning');
      await ctx.close();
    }

    // 10% of a small daily limit must win over the flat 5 when it is smaller.
    // limit 20 → 10% = 2 → threshold 2.  3 remaining must stay silent.
    const { ctx, page } = await setupChat(browser, { remaining: 3, dailyLimit: 20, replyText: 'ok' });
    await gotoInsights(page);
    await openChat(page);
    const warnCount = await page.locator('[data-testid="chat-low-limit-warning"]').count();
    rec('B3b smaller-of-the-two rule: limit 20 → threshold 2, so 3 left is silent', warnCount === 0, `warning=${warnCount}`);
    await ctx.close();
  }

  await browser.close();

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  try {
    const passed = results.filter((r) => r.pass).length;
    fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ passed, total: results.length, results, crashed: String(e) }, null, 2));
  } catch {}
  process.exit(1);
});
