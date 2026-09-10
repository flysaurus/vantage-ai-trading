// ─────────────────────────────────────────────────────────────
// PART 4 — GLOBAL Ask-Rufus-bar overlap audit.
//
// Contract: EVERY scrollable screen renders its content through the SHARED
// PageScrollArea, which owns both the scroller and the bar and reserves
// `bar.bottom + bar.height + 12px` as a margin. Nothing can forget it.
//
// For each screen this harness:
//   1. asserts the shared scroller marker ([data-page-scroller]) is present
//   2. asserts the reserved band matches the REAL bar geometry
//   3. scrolls to the bottom and asserts the scroll viewport ends above the
//      bar's top edge (structural clip, not a padding illusion)
//   4. finds the LAST interactive control in the screen and asserts it can be
//      brought fully above the bar (rect.bottom <= barTop)
//   5. asserts exactly ONE Ask Rufus bar exists (no duplicate bars per screen)
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.APP_BASE || 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = process.env.SHOT_DIR || '/tmp/vantage-shots/bar-band-global';
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const pos = JSON.parse(fs.readFileSync('/tmp/vantage-positions.json', 'utf8'));
const ALPACA = 'ae013e41-06b3-4f7e-83a1-74b8a54ad207';

const b64u = (s) => Buffer.from(s, 'utf8').toString('base64url');
const sessionObj = {
  access_token: session.access_token, token_type: 'bearer', expires_in: 3600,
  expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user,
};
const localSession = JSON.stringify(sessionObj);
const cookieVal = 'base64-' + b64u(JSON.stringify(sessionObj));
const cookieName = `sb-${REF}-auth-token`;

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

const rows = pos.alpaca;
const alpacaCash = 25000;
function rawPositions(list) {
  return list.map((r) => ({
    symbol: r.symbol, name: r.name || r.symbol, assetType: 'stock', units: r.qty,
    costBasis: (r.qty || 0) * (r.avg_cost || 0), price: r.current_price || r.avg_cost || 0,
    marketValue: r.market_value || 0, dayChange: 0, dayChangePct: 0,
    openPnl: r.unrealized_pnl || 0, currency: 'USD',
  }));
}
const positions = rawPositions(rows);
const mv = positions.reduce((s, p) => s + p.marketValue, 0);
const pnl = positions.reduce((s, p) => s + p.openPnl, 0);
const acctJson = {
  totalValue: mv + alpacaCash, cash: alpacaCash, buyingPower: alpacaCash, invested: mv, marketValue: mv,
  dayChange: 0, dayChangePct: 0, totalPnl: pnl, totalPnlPct: 0, currency: 'USD',
  accountStatus: 'open', lastSynced: new Date().toISOString(), holdingsUnavailable: false, positions,
};
const accounts = [
  { id: 'demo', name: 'Demo Portfolio', broker: 'Vantage Demo', isDemo: true, tradingEnabled: true, totalValue: 100000, buyingPower: 100000, cash: 100000, environment: 'demo' },
  { id: `snaptrade:${ALPACA}`, name: 'Alpaca Paper', broker: 'Alpaca Paper', brokerageSlug: 'ALPACA-PAPER', isDemo: false, tradingEnabled: true, totalValue: mv + alpacaCash, buyingPower: alpacaCash, cash: alpacaCash, environment: 'paper', connectionId: ALPACA },
];

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
  await routePath(page, '/api/auth/me', (r) => r.fulfill({ json: { user: {
    id: session.user.id, email: session.user.email, first_name: 'Milind', last_name: 'Parikh',
    investor_style: 'soros', risk_tolerance: 'moderate', tier: 'demo',
    demo_start_at: '2026-07-03T19:00:00+00:00', demo_expires_at: null,
    connection_type: null, connection_status: null, investor_style_onboarded: true,
    investorStyleOnboarded: true, investorStyle: 'soros', riskTolerance: 'moderate' } } }));
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
  await routePath(page, '/api/ai/daily-brief', (r) => r.fulfill({ json: { content: 'MARKET: Tech leads the tape.\nPORTFOLIO: Financials carry the book.', cached: true } }));
  await routePath(page, '/api/ai/weekly-snapshot', (r) => r.fulfill({ json: { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true } }));
  await routePath(page, '/api/ai/noticed', (r) => (r.request().method() === 'GET'
    ? r.fulfill({ json: { items: [] } }) : r.fulfill({ json: { ok: true } })));
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
  await routePath(page, '/api/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"text":"mocked"}\n\ndata: [DONE]\n\n' }));
  return { ctx, page };
}

/** Geometry of the shared scroller + the bar on the current screen. */
const geometry = (page) => page.evaluate(() => {
  // Pre-fix builds have no shared scroller — fall back to the raw container so the
  // same measurements still run (and the missing marker shows up as a failure).
  const shared = !!document.querySelector('[data-page-scroller]');
  const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
  const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
  const bars = document.querySelectorAll('[data-testid="ask-rufus-bar"]').length;
  const legal = ['.content-area', '[data-page-scroller]'];
  const rawScrollers = [...document.querySelectorAll('.content-area')].length;
  if (!sc || !bar) return { missing: !sc ? 'scroller' : 'bar', bars, shared };
  const cs = getComputedStyle(sc);
  const barRect = bar.getBoundingClientRect();
  const scRect = sc.getBoundingClientRect();
  return {
    shared,
    bars,
    rawScrollers,
    scrollerTop: scRect.top,
    scrollerBottom: scRect.bottom,
    barTop: barRect.top,
    band: parseFloat(sc.getAttribute('data-rufus-bar-band') || '0'),
    marginBottom: cs.marginBottom,
    paddingBottom: cs.paddingBottom,
    scrollPaddingBottom: cs.scrollPaddingBottom,
    scrollHeight: sc.scrollHeight,
    clientHeight: sc.clientHeight,
    overflowY: cs.overflowY,
  };
});

(async () => {
  const browser = await chromium.launch();
  const SCREENS = [
    { tab: 'insights', label: 'Insights' },
    { tab: 'portfolio', label: 'Holdings' },
    { tab: 'invest', label: 'Invest' },
    { tab: 'settings', label: 'Settings' },
  ];

  for (const theme of ['light']) {
    for (const scr of SCREENS) {
      const { ctx, page } = await setup(browser, { theme });
      await page.goto(`${BASE}/?tab=${scr.tab}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 60000 });
      await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none !important}'; document.head.appendChild(s); });
      await page.waitForTimeout(1200);

      const g = await geometry(page);
      const tag = `${theme}/${scr.tab}`;
      if (g.missing) { rec(`${tag} shared scroller + bar present`, false, g.missing); await ctx.close(); continue; }

      rec(`${tag} renders the SHARED PageScrollArea scroller`, g.shared === true, `shared-marker=${g.shared} content-area nodes=${g.rawScrollers}`);
      rec(`${tag} exactly ONE Ask Rufus bar`, g.bars === 1, `bars=${g.bars}`);

      const barHeight = Math.round(g.barTop <= g.scrollerBottom ? g.scrollerBottom - g.barTop : 0);
      const expected = Math.round(parseFloat(g.marginBottom) || 0);
      rec(`${tag} reserves a band >= bar height + 12px gap`,
        expected >= barHeight + 12 - 1,
        `margin=${expected}px barVisible=${barHeight}px band=${g.band}`);

      // Scroll to the very bottom (content can still be growing — loop until the
      // scroller is genuinely pinned at max) then measure the structural clip.
      for (let i = 0; i < 8; i++) {
        await page.evaluate(() => {
          const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
          sc.scrollTop = sc.scrollHeight;
        });
        await page.waitForTimeout(400);
        const pinned = await page.evaluate(() => {
          const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
          return Math.abs((sc.scrollHeight - sc.clientHeight) - sc.scrollTop) <= 2;
        });
        if (pinned) break;
      }
      await page.waitForTimeout(400);
      const after = await page.evaluate(() => {
        const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
        const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
        return {
          scrollerBottom: sc.getBoundingClientRect().bottom,
          barTop: bar.getBoundingClientRect().top,
          scrollTop: sc.scrollTop,
          maxScroll: sc.scrollHeight - sc.clientHeight,
          atBottom: Math.abs((sc.scrollHeight - sc.clientHeight) - sc.scrollTop) <= 2,
        };
      });
      rec(`${tag} scrolled to the true bottom`,
        after.atBottom, `scrollTop=${Math.round(after.scrollTop)} max=${Math.round(after.maxScroll)}`);
      rec(`${tag} STRUCTURAL: scroller viewport ends at/above the bar top`,
        after.scrollerBottom <= after.barTop + 1,
        `scrollerBottom=${after.scrollerBottom.toFixed(1)} barTop=${after.barTop.toFixed(1)}`);

      // ── MID-SCROLL probe (the real-world failure mode) ──
      // With a `position:fixed` bar, content passes BENEATH the pill at every
      // scroll position except the very end. Probe several fractions of the
      // scroll range and count elements that end up behind the bar.
      const probes = [];
      for (const frac of [0.25, 0.5, 0.75]) {
        await page.evaluate((f) => {
          const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
          sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f;
        }, frac);
        await page.waitForTimeout(350);
        const p = await page.evaluate(() => {
          const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
          const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
          const barTop = bar.getBoundingClientRect().top;
          const scBox = sc.getBoundingClientRect();
          const leaves = [...sc.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').trim());
          let under = 0, sample = '', worst = 0;
          for (const el of leaves) {
            const r = el.getBoundingClientRect();
            if (r.height < 4) continue;
            // visible slice after the scroller clips it
            const visTop = Math.max(r.top, scBox.top);
            const visBottom = Math.min(r.bottom, scBox.bottom, window.innerHeight);
            if (visBottom - visTop < 4) continue;
            if (visBottom > barTop + 1) {
              under++;
              if (visBottom - barTop > worst) { worst = visBottom - barTop; sample = (el.textContent || '').trim().slice(0, 30); }
            }
          }
          return { under, sample, worst: Math.round(worst), scrollerBottom: Math.round(scBox.bottom), barTop: Math.round(barTop) };
        });
        probes.push({ frac, ...p });
        if (probes.length === 1 || p.under > 0) {
          await page.screenshot({ path: `${OUT}/${theme}-${scr.tab}-midscroll-${Math.round(frac * 100)}.png` });
        }
      }
      rec(`${tag} nothing scrolls UNDER the bar at ANY scroll position`,
        probes.every((p) => p.under === 0),
        probes.map((p) => `${Math.round(p.frac * 100)}%:${p.under}${p.sample ? `("${p.sample}")` : ''}`).join(' '));

      // No live content may sit under the bar once the screen is scrolled to its
      // end: the bar permanently overlays the bottom of the scroller pre-fix.
      const overlap = await page.evaluate(() => {
        const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area');
        const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
        const barTop = bar.getBoundingClientRect().top;
        const scBox = sc.getBoundingClientRect();
        const leaves = [...sc.querySelectorAll('*')].filter((el) => el.children.length === 0 && (el.textContent || '').trim());
        let under = 0, worst = 0, sample = '';
        for (const el of leaves) {
          const r = el.getBoundingClientRect();
          if (r.height < 4) continue;
          const visTop = Math.max(r.top, scBox.top);
          const visBottom = Math.min(r.bottom, scBox.bottom, window.innerHeight);
          if (visBottom - visTop < 4) continue;
          if (visBottom > barTop + 1) {
            under++;
            if (visBottom - barTop > worst) { worst = visBottom - barTop; sample = (el.textContent || '').trim().slice(0, 32); }
          }
        }
        return { under, worst: Math.round(worst), sample, barTop: Math.round(barTop), scrollerBottom: Math.round(scBox.bottom) };
      });
      rec(`${tag} no live content sits UNDER the bar at the end of the scroll`,
        overlap.under === 0,
        overlap.under ? `${overlap.under} element(s) under the bar, worst +${overlap.worst}px ("${overlap.sample}")` : `0 elements under the bar (barTop=${overlap.barTop})`);

      await page.screenshot({ path: `${OUT}/${theme}-${scr.tab}-bottom.png` });
      fs.writeFileSync(`${OUT}/${theme}-${scr.tab}.json`, JSON.stringify({ geometry: g, after, probes, overlap }, null, 2));
      await ctx.close();
    }
  }

  // ── The specific regression Em reported: Settings → Investor Style
  //    "Save Style" must be fully visible + clickable, not behind the bar. ──
  {
    const { ctx, page } = await setup(browser, { theme: 'light' });
    await page.goto(`${BASE}/?tab=settings`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 60000 });
    await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none !important}'; document.head.appendChild(s); });
    await page.waitForTimeout(1000);

    // The "Save Style" control lives inside the Investor Style sheet, opened
    // from the Settings list row (the exact screen Em reported as covered).
    const opened = await page.evaluate(() => {
      const sc = document.querySelector('[data-page-scroller]') || document.querySelector('.content-area') || document.body;
      const cands = [...sc.querySelectorAll('button, a, [role="button"], div')];
      const target = cands.find((el) => {
        const t = el.textContent || '';
        const h = el.getBoundingClientRect().height;
        return /Investor Style/.test(t) && /\u203a/.test(t) && h > 20 && h < 120;
      });
      if (!target) return null;
      target.click();
      return (target.textContent || '').trim().slice(0, 40);
    });
    await page.waitForTimeout(1200);
    rec('S0 Investor Style sheet opens from the Settings row', !!opened, String(opened));

    const btn = await page.$('button:has-text("Save Style")');
    rec('S1 Settings: "Save Style" button exists', !!btn);
    if (btn) {
      await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(800);
      const m = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Save Style/.test(x.textContent || ''));
        const bar = document.querySelector('[data-testid="ask-rufus-bar"]');
        const r = b.getBoundingClientRect();
        const br = bar.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        // Is the bar itself visible anywhere, or is an overlay (this sheet) on top?
        const bx = br.left + br.width / 2, by = br.top + br.height / 2;
        const barHit = document.elementFromPoint(bx, by);
        const barOnTop = !!(barHit && (barHit === bar || bar.contains(barHit)));
        return {
          top: r.top, bottom: r.bottom, barTop: br.top,
          fullyAboveBar: r.bottom <= br.top + 1,
          barOnTop,
          inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
          hitIsButton: !!(hit && (hit === b || b.contains(hit) || hit.closest('button') === b)),
        };
      });
      rec('S2 "Save Style" is never covered by the bar (above it, or the sheet is on top of the bar)',
        m.fullyAboveBar || !m.barOnTop,
        `bottom=${m.bottom.toFixed(1)} barTop=${m.barTop.toFixed(1)} barOnTop=${m.barOnTop}`);
      rec('S3 "Save Style" is fully in the viewport', m.inViewport, `top=${m.top.toFixed(1)} bottom=${m.bottom.toFixed(1)} vh=${932}`);
      rec('S4 "Save Style" is the topmost element at its own centre point (really clickable)', m.hitIsButton, JSON.stringify(m));
      const el = await page.$('button:has-text("Save Style")');
      const section = await page.evaluateHandle(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /Save Style/.test(x.textContent || ''));
        return b ? b.closest('section, [data-testid], div') : null;
      });
      const sh = await section.asElement();
      if (sh) { try { await sh.screenshot({ path: `${OUT}/settings-investor-style.png` }); } catch (e) {} }
      await el.screenshot({ path: `${OUT}/settings-save-style.png` });
      await page.screenshot({ path: `${OUT}/settings-investor-style-full.png` });
    }
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
