// ─────────────────────────────────────────────────────────────
// ROUND 4 — "More from Rufus" secondary notices list.
//
// Contract under test (Em's Round-4 item 7):
//   • sits DIRECTLY BELOW the hero deck's dot indicator (and above the
//     Portfolio Health card)
//   • ONE compact line per item: icon + single-line Rufus-voice copy
//   • surfaces event-impact notices of BOTH tiers (review + info) — this is the
//     complete event-impact inventory, deliberately not filtered against the deck
//   • actionable items (REVIEW_POSITION) get a "Review" link that uses the
//     existing PositionCard navigation; informational items get NO action
//   • copy is ALWAYS real generated/humanized copy — never the raw
//     deterministic context string ("severity: info. Informational only…")
//   • renders nothing at all when there is nothing to surface
// ─────────────────────────────────────────────────────────────
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/more-from-rufus';
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

/* ── fixture ── */
const rows = pos.alpaca;
const totalMV = rows.reduce((s, r) => s + (r.market_value || 0), 0);
const ranked = [...rows].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
const top1 = ranked[0];
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

// 1. Deck item — must NOT be duplicated in "More from Rufus"
const CONC = item('mock-conc', 'concentration_single', 'Concentration risk',
  `${top1.symbol} alone is 30% of your portfolio.`,
  'warn', '⚖️', 'REBALANCE', { symbol: top1.symbol });

// 2. event-impact REVIEW tier — deck-eligible, must NOT appear here
const EVENT_REVIEW = item('mock-event-review', 'event_impact', 'Earnings watch',
  'NVDA reports Thursday.', 'accent', '📅', 'REVIEW_POSITION:NVDA', { severity: 'review', symbol: 'NVDA' });

// 3. event-impact INFO tier WITH A RAW CONTEXT BODY (the engine leak we fixed).
//    The list must never render that string — it must humanize from fields.
const RAW = 'NVDA: earnings event — Q3 beat and raised guidance (Reuters). severity: info. Informational only — no action needed.';
const EVENT_INFO = item('mock-event-info', 'event_impact', 'NVDA — earnings update', RAW,
  'info', '📰', undefined, { severity: 'info', symbol: 'NVDA', category: 'earnings', headline: 'Q3 beat and raised guidance', source: 'Reuters' });

// 4. Milestone / target-return crossing — ACTIONABLE, gets a Review link
const MILESTONE = item('mock-milestone', 'position_milestone', 'XLF crossed +25%', 
  'XLF crossed +25% — worth a look.', 'gain', '🎯', 'REVIEW_POSITION:XLF', { symbol: 'XLF', threshold: 25, currentPnlPct: 26.4 });

const NOTICED = [CONC, EVENT_REVIEW, EVENT_INFO, MILESTONE];
const DAILY = { content: 'MARKET: Tech leads the tape.\nPORTFOLIO: Financials are carrying the book.\nWATCH: XLF near a 52-week high.', cached: true };
const WEEKLY = { content: 'SUMMARY: Concentration is elevated.', healthScore: 7, riskLevel: 'moderate', cached: true };

const routePath = (page, pathname, handler) =>
  page.route((url) => new URL(url).pathname === pathname, handler);

async function setup(browser, { theme = 'light', items = NOTICED } = {}) {
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
    ? r.fulfill({ json: { items } }) : r.fulfill({ json: { ok: true } })));
  await routePath(page, '/api/ai/noticed/dismiss', (r) => r.fulfill({ json: { ok: true } }));
  await routePath(page, '/api/usage/remaining', (r) => r.fulfill({ json: { chatRemaining: 40 } }));
  await routePath(page, '/api/usage/stats', (r) => r.fulfill({ json: { tier: 'silver', chat: { daily: { used: 0, limit: 50 }, monthly: { used: 0, limit: 1000 } } } }));
  await routePath(page, '/api/chat', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'data: {"text":"mocked"}\n\ndata: [DONE]\n\n' }));

  await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="more-from-rufus"], [data-testid="portfolio-health-card"]', { timeout: 40000 });
  await page.evaluate(() => { const s = document.createElement('style'); s.textContent = 'nextjs-portal{display:none !important}'; document.head.appendChild(s); });
  await page.waitForTimeout(600);
  return { ctx, page };
}

const rect = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
}, sel);

(async () => {
  const browser = await chromium.launch();

  /* ── A. Light theme ── */
  {
    const { ctx, page } = await setup(browser, { theme: 'light' });

    // A1 — present
    const list = await page.$('[data-testid="more-from-rufus"]');
    rec('A1 More-from-Rufus section renders', !!list);

    if (list) {
      // A2 — ONLY event-impact items, BOTH tiers. The milestone/crossing row must
      //      be GONE (it is now an inline badge on the position row).
      const rowCount = await page.$$eval('[data-testid="more-from-rufus-row"]', (n) => n.length);
      rec('A2 Exactly 2 rows (review-tier + info-tier event-impact)', rowCount === 2, `rows=${rowCount}`);

      // A3 — a non-event-impact notice (the concentration deck card) never lands here
      const texts = await page.$$eval('[data-testid="more-from-rufus-text"]', (n) => n.map((e) => e.textContent.trim()));
      rec('A3 Non-event notice (concentration) not listed', !texts.some((t) => /Concentration risk/i.test(t)), JSON.stringify(texts));
      rec('A4 Review-tier event IS listed (owns the Review link)', texts.some((t) => /NVDA reports Thursday/i.test(t)), JSON.stringify(texts));
      rec('A4b Threshold/milestone crossing is NOT a list item any more',
        !texts.some((t) => /XLF/.test(t) && /crossed/i.test(t)), JSON.stringify(texts));

      // A5 — copy hygiene: NO raw deterministic context anywhere in the section
      const section = await page.$eval('[data-testid="more-from-rufus"]', (el) => el.innerText);
      const RAW_MARKERS = [/severity:\s*(info|review)/i, /informational only/i, /no action needed/i,
        /total return threshold/i, /position value:\s*\$/i, /consecutive trading days/i];
      const leaked = RAW_MARKERS.filter((re) => re.test(section));
      rec('A5 No raw context string in rendered copy', leaked.length === 0,
        leaked.length ? `leaked=${leaked}` : section.replace(/\n/g, ' | ').slice(0, 120));

      // A6 — the raw-body info item was humanized from structured fields
      rec('A6 Info row humanized from fields (symbol + headline)',
        texts.some((t) => /NVDA/.test(t) && /Q3 beat/i.test(t)));

      // A7 — actionable row has a Review link, informational row does not
      const actionable = await page.$$eval('[data-testid="more-from-rufus-row"]', (n) => n.map((e) => ({
        actionable: e.getAttribute('data-actionable'),
        hasReview: !!e.querySelector('[data-testid="more-from-rufus-review"]'),
        ticker: e.querySelector('[data-testid="more-from-rufus-review"]')?.getAttribute('data-ticker') || null,
      })));
      const a = actionable.filter((r) => r.actionable === 'true');
      const info = actionable.filter((r) => r.actionable === 'false');
      rec('A7 Exactly one actionable row, with a Review link for its REVIEW_POSITION action',
        a.length === 1 && a[0].hasReview && a[0].ticker === 'NVDA', JSON.stringify(a));
      rec('A8 Informational row has NO action link', info.length === 1 && !info[0].hasReview, JSON.stringify(info));

      // A9 — one line per row (nowrap, no wrap → single-line height)
      const lineHeights = await page.$$eval('[data-testid="more-from-rufus-text"]', (n) => n.map((e) => {
        const cs = getComputedStyle(e);
        return { h: e.getBoundingClientRect().height, ws: cs.whiteSpace, overflow: cs.textOverflow };
      }));
      rec('A9 Each row is a single line (nowrap + ellipsis)',
        lineHeights.every((l) => l.ws === 'nowrap' && l.overflow === 'ellipsis' && l.h < 30),
        JSON.stringify(lineHeights));

      // A10 — POSITION: below deck dots, above Portfolio Health card
      const dots = await rect(page, '[data-testid="deck-dots"]');
      const sect = await rect(page, '[data-testid="more-from-rufus"]');
      const health = await rect(page, '[data-testid="portfolio-health-card"]');
      rec('A10 Sits below the deck dot indicator', !!dots && !!sect && sect.top >= dots.bottom - 1,
        `dots.bottom=${dots?.bottom?.toFixed(1)} section.top=${sect?.top?.toFixed(1)}`);
      rec('A11 Sits above the Portfolio Health card', !!health && !!sect && sect.bottom <= health.top + 1,
        `section.bottom=${sect?.bottom?.toFixed(1)} health.top=${health?.top?.toFixed(1)}`);

      // A12 — card container uses the canvas card token (real card, not bare text)
      const cardStyles = await page.$eval('[data-testid="more-from-rufus-card"]', (e) => {
        const cs = getComputedStyle(e);
        return { bg: cs.backgroundColor, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius };
      });
      rec('A12 Renders as a real card container', cardStyles.bg !== 'rgba(0, 0, 0, 0)' && parseInt(cardStyles.radius) >= 12,
        JSON.stringify(cardStyles));

    // A14 — screenshots (before navigating away)
    await page.screenshot({ path: `${OUT}/mfr-light.png` });
    {
      const el = await page.$('[data-testid="more-from-rufus"]');
      await el.screenshot({ path: `${OUT}/mfr-light-section.png` });
    }
      // A13 — Review link navigates with the existing PositionCard flow
      await page.locator('[data-testid="more-from-rufus-review"]').evaluate((el) => el.click());
      await page.waitForTimeout(900);
      const navState = await page.evaluate(() => ({
        portfolioActive: !!document.querySelector('[data-testid="nav-portfolio"][aria-current="page"], [data-testid="nav-portfolio"][data-active="true"]'),
        body: document.body.innerText.slice(0, 0),
        hasHoldingsHeading: /Holdings|Your Positions|Positions/i.test(document.body.innerText),
      }));
      rec('A13 Review link opens Holdings with the position', navState.portfolioActive || navState.hasHoldingsHeading,
        JSON.stringify(navState));

      fs.writeFileSync(`${OUT}/mfr-nav-after-review.txt`, JSON.stringify(navState, null, 2));
    }

    // A14 — screenshot
    await ctx.close();
  }

  /* ── B. Dark theme parity ── */
  {
    const { ctx, page } = await setup(browser, { theme: 'dark' });
    const styles = await page.$eval('[data-testid="more-from-rufus-card"]', (e) => {
      const cs = getComputedStyle(e);
      const txt = e.querySelector('[data-testid="more-from-rufus-text"]');
      return { bg: cs.backgroundColor, text: txt ? getComputedStyle(txt).color : null };
    });
    // Dark card token (#0a0f1e / #10162a family) — NOT the light white card.
    const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (styles.bg.startsWith('rgb(10') || styles.bg.startsWith('rgb(16')) ? (() => {
      const L1 = lum(styles.bg), L2 = lum(styles.text);
      return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    })() : 0;
    rec('B1 Dark: card uses the dark canvas token + readable text',
      styles.bg !== 'rgb(255, 255, 255)' && contrast >= 4.5,
      `bg=${styles.bg} text=${styles.text} contrast=${contrast.toFixed(2)}:1`);
    await page.screenshot({ path: `${OUT}/mfr-dark.png` });
    const el = await page.$('[data-testid="more-from-rufus"]');
    await el.screenshot({ path: `${OUT}/mfr-dark-section.png` });
    await ctx.close();
  }

  /* ── C. Nothing to surface → renders nothing ── */
  {
    // A deck card (concentration) + a threshold crossing: neither is event-impact,
    // so the list must render nothing at all.
    const deckOnly = [CONC, MILESTONE];
    const { ctx, page } = await setup(browser, { theme: 'light', items: deckOnly });
    const present = await page.$('[data-testid="more-from-rufus"]');
    rec('C1 Renders nothing when no event-impact items exist', !present);
    await ctx.close();
  }

  /* ── D. Review-tier event-impact that is NOT deck-eligible (no severity
        field) → appears in the list WITH a working Review link. Proves the
        link only ever appears for a real REVIEW_POSITION action. ── */
  {
    const reviewNoSev = item('mock-review-nosev', 'event_impact', 'XLF — regulatory update',
      'XLF has a regulatory update — the SEC opened a comment window.',
      'accent', '📰', 'REVIEW_POSITION:XLF', { symbol: 'XLF', category: 'regulatory' });
    const infoWithAction = item('mock-info-with-action', 'event_impact', 'NVDA — earnings update',
      'NVDA posted an earnings update — Q3 beat and raised guidance.',
      'info', '📰', 'REVIEW_POSITION:NVDA', { symbol: 'NVDA', severity: 'info', category: 'earnings' });

    const { ctx, page } = await setup(browser, { theme: 'light', items: [reviewNoSev, infoWithAction] });
    const rows = await page.$$eval('[data-testid="more-from-rufus-row"]', (n) => n.map((e) => ({
      actionable: e.getAttribute('data-actionable'),
      hasReview: !!e.querySelector('[data-testid="more-from-rufus-review"]'),
      ticker: e.querySelector('[data-testid="more-from-rufus-review"]')?.getAttribute('data-ticker') || null,
      text: e.querySelector('[data-testid="more-from-rufus-text"]')?.textContent.trim(),
    })));
    const act = rows.filter((r) => r.actionable === 'true');
    const inf = rows.filter((r) => r.actionable === 'false');
    rec('D1 Review-tier event renders WITH a Review link', act.length === 1 && act[0].hasReview && act[0].ticker === 'XLF', JSON.stringify(rows));
    rec('D2 Info-tier item with an action still gets NO link', inf.length === 1 && !inf[0].hasReview, JSON.stringify(inf));
    rec('D3 Exactly 2 rows (both event-impact tiers)', rows.length === 2, `rows=${rows.length}`);

    if (act.length) {
      await page.locator('[data-testid="more-from-rufus-review"]').evaluate((el) => el.click());
      await page.waitForTimeout(900);
      const navState = await page.evaluate(() => ({
        portfolioActive: !!document.querySelector('[data-testid="nav-portfolio"][aria-current="page"], [data-testid="nav-portfolio"][data-active="true"]'),
        hasHoldingsHeading: /Holdings|Your Positions|Positions/i.test(document.body.innerText),
      }));
      rec('D4 Review link navigates to Holdings', navState.portfolioActive || navState.hasHoldingsHeading, JSON.stringify(navState));
    }
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
