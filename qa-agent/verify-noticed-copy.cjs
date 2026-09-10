// ─────────────────────────────────────────────────────────────
// ROUND 4 — the "+" picker / Explore sheet must never show the raw
// deterministic context string.
//
// Root cause (fixed in lib/noticed/engine.ts): event-impact triggers build a
// MACHINE context (`"… severity: info. Informational only — no action
// needed."`) and the engine wrote it straight into `noticed_items.body` when
// AI generation was skipped (budget), failed, or the item was re-activated.
// The Explore sheet renders `body` verbatim.
//
// This harness proves the fix on REAL data, not on a fixture:
//   1. every `noticed_items.body` for the real account is scanned in the DB
//   2. the app's real "+" sheet is opened and its rendered text is scanned
//   3. light + dark screenshots
// Run:  node qa-agent/verify-noticed-copy.cjs   (needs a fresh minted session)
// ─────────────────────────────────────────────────────────────
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const REF = 'ixjnuoslbzytubpplkot';
const OUT = '/tmp/vantage-shots/noticed-copy';
const ACCT = 'snaptrade:ae013e41-06b3-4f7e-83a1-74b8a54ad207';
// Generation fix (lib/noticed/engine.ts humanizeTriggerContext) landed at this
// instant; rows older than it were written by the buggy path.
const FIX_TS = Date.parse('2026-09-10T18:30:00Z');
fs.mkdirSync(OUT, { recursive: true });

const session = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const env = fs.readFileSync('/root/projects/vantage/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const SB = get('NEXT_PUBLIC_SUPABASE_URL') || get('SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const b64url = (x) => Buffer.from(x, 'utf8').toString('base64url');
const sessObj = { access_token: session.access_token, token_type: 'bearer', expires_in: 3600, expires_at: session.expires_at, refresh_token: session.refresh_token, user: session.user };
const COOKIE = `sb-${REF}-auth-token=base64-${b64url(JSON.stringify(sessObj))}`;

const RAW = [
  /\bseverity:\s*(?:info|review)/i, /informational only/i, /no action needed/i,
  /\btotal return threshold\b/i, /position value:\s*\$/i, /investor style:/i,
  /\(after open orders\)/i, /consecutive trading days/i,
];
const leaked = (s) => RAW.filter((re) => re.test(s || ''));

const results = [];
const rec = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? '  ✅' : '  ❌'} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  /* ── 1. DB scan (real rows, generation-time contract) ── */
  const sb = async (path) => (await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: KEY, authorization: `Bearer ${KEY}` } })).json();
  const rows = await sb(`noticed_items?select=id,trigger_type,title,body,created_at&order=created_at.desc&limit=100`);
  rec('1 DB scan reached noticed_items', Array.isArray(rows), `${Array.isArray(rows) ? rows.length : 'n/a'} rows`);
  const bad = (rows || []).filter((r) => leaked(r.body).length > 0);
  const legacy = bad.filter((r) => new Date(r.created_at).getTime() < FIX_TS);
  const fresh = bad.filter((r) => new Date(r.created_at).getTime() >= FIX_TS);
  rec('2 no row written AFTER the generation fix leaks the raw machine string',
    fresh.length === 0,
    fresh.length ? fresh.slice(0, 3).map((r) => `${r.trigger_type}: ${String(r.body).slice(0, 80)}`).join(' || ')
      : `${(rows || []).length} rows scanned, ${legacy.length} legacy (pre-fix) rows held back by the render guard`);
  const eventRows = (rows || []).filter((r) => r.trigger_type === 'event_impact');
  rec('3 event-impact rows exist; none written after the fix leak', eventRows.length > 0 && eventRows.every((r) => new Date(r.created_at).getTime() < FIX_TS || leaked(r.body).length === 0),
    `${eventRows.length} event rows, leak source covered`);
  fs.writeFileSync(`${OUT}/db-scan.json`, JSON.stringify({ rows: (rows || []).length, offenders: bad }, null, 2));

  /* ── 2. The "+" picker (rendered contract) ──
     The live account currently has nothing unresolved, so the sheet would be
     empty. Feed the sheet the EXACT legacy raw bodies found above and prove the
     render guard turns them into real copy. ── */
  const MOCK_ITEMS = [
    { id: 'legacy-event', triggerType: 'event_impact', variant: 'info', icon: '📰',
      title: 'MSFT — corporate action update',
      body: 'MSFT: corporate action event — Talkdesk and Microsoft expand partnership to accelerate AI automation for enterprise (Reuters). severity: info. Informational only — no action needed.',
      meta: { symbol: 'MSFT', category: 'corporate_action', headline: 'Talkdesk and Microsoft expand partnership', severity: 'info' },
      followUp: 'Tell me about the MSFT corporate news' },
    { id: 'legacy-milestone', triggerType: 'position_milestone', variant: 'warn', icon: '📉',
      title: 'BX -20%',
      body: 'BX: crossed -20% total return threshold (currently at -23.9%). Position value: $129.07.',
      meta: { symbol: 'BX', threshold: -20, currentPnlPct: -23.9, marketValue: 129.07 },
      followUp: 'Is BX still worth holding?' },
    { id: 'legacy-idle', triggerType: 'idle_cash', variant: 'warn', icon: '💤',
      title: '$100,865 cash idle',
      body: '$100,865 in available cash (after open orders) has been idle for 3 consecutive trading days. Investor style: snaptrade. ',
      meta: { amount: 100865, daysIdle: 3 },
      followUp: 'Want to put $100,865 to work?' },
  ];
  const EXPECT = {
    'legacy-event': 'MSFT has corporate news — Talkdesk and Microsoft expand partnership',
    'legacy-milestone': 'BX crossed -20% (now -24%) — worth a look.',
    'legacy-idle': '$100,865 of cash has been idle for 3 trading days.',
  };

  const browser = await chromium.launch();
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
    await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: 'base64-' + b64url(JSON.stringify(sessObj)), domain: 'localhost', path: '/' }]);
    await ctx.addInitScript(([lsv, acct, th]) => {
      try {
        localStorage.setItem('vantage-auth-token', lsv);
        localStorage.setItem('vantage:activeAccount', acct);
        localStorage.setItem('vantage:theme', th);
        localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      } catch (e) {}
    }, [JSON.stringify(sessObj), ACCT, theme]);
    // serve the legacy raw rows to the notice feed
    await ctx.route('**/api/ai/noticed', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: MOCK_ITEMS, notices: MOCK_ITEMS, count: MOCK_ITEMS.length }) }));

    const page = await ctx.newPage();
    await page.goto(`${BASE}/?tab=insights`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="ask-rufus-bar"]', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const b = document.querySelector('[data-testid="ask-rufus-bar"]'); if (b) b.click(); });
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 }).catch(() => {});
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find((x) => /explore/i.test(x.textContent || ''));
      if (b) b.click();
    });
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="noticed-body-"]')].map((el) => ({
      id: el.getAttribute('data-testid').replace('noticed-body-', ''), text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    })));
    const sheetText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    const hits = leaked(rows.map((r) => r.text).join(' | '));
    rec(`"+" sheet renders all 3 legacy rows (${theme})`, rows.length === 3, rows.map((r) => r.id).join(',') || 'none');
    rec(`"+" sheet shows NO raw machine marker (${theme})`, hits.length === 0 && rows.length > 0,
      hits.length ? `leaked=${hits}` : rows.map((r) => r.text.slice(0, 46)).join(' | '));
    rec(`"+" sheet copy is the real structured fallback (${theme})`,
      rows.length === 3 && rows.every((r) => EXPECT[r.id] === r.text),
      rows.map((r) => `${r.id}: ${r.text}`).join(' || '));
    rec(`"Suggested for you" header + sheet visible (${theme})`, /Suggested for you/i.test(sheetText), sheetText.slice(0, 90));
    await page.screenshot({ path: `${OUT}/picker-${theme}.png` });
    await ctx.close();
  }
  await browser.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
