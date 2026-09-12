// qa-agent/verify-rebalance-cancel.cjs
//
// Regression harness: leaving /strategies/setup/rebalancing must return the user
// to the page they came from — and must NOT re-show the "Welcome to Vantage"
// account picker (which MainApp re-renders on every fresh mount at '/' unless
// the user ticked "Don't show this again").
//
// Emulates the reported state: at the moment of leaving, the session had no
// `vantage:skipAccountSelect:v2` opt-out (picking an account does not write that
// key unless the checkbox is ticked).
//
//   node qa-agent/verify-rebalance-cancel.cjs            # dev server (default)
//   APP_BASE=https://vantage-ai-trading.vercel.app node qa-agent/verify-rebalance-cancel.cjs
//
// Exit code 1 if any check fails.

const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.APP_BASE || 'http://127.0.0.1:3002';
const REF = 'ixjnuoslbzytubpplkot';
const SESSION = JSON.parse(fs.readFileSync('/tmp/vantage-session.json', 'utf8'));
const COOKIE = 'base64-' + Buffer.from(JSON.stringify(SESSION)).toString('base64url');
const HOST = new URL(BASE).hostname;
const SKIP_KEY = 'vantage:skipAccountSelect:v2';

// Long-lived opt-out ON at boot (so the harness can navigate); the key is dropped
// right before the reported action to recreate Em's session state.
const AUTH_INIT = (skip) => {
  try {
    localStorage.setItem('vantage-auth-token', '1');
    localStorage.setItem('vantage:theme', 'dark');
    localStorage.setItem('vantage:activeAccount', 'snaptrade:ae013e41-06b3-4f7e-83a1-74b8a54ad207');
    if (skip) localStorage.setItem('vantage:skipAccountSelect:v2', '1');
  } catch {}
};
const KILL = `(() => { document.querySelectorAll('nextjs-portal').forEach(n => { try { if (n.shadowRoot) n.shadowRoot.innerHTML=''; } catch(e){} n.remove(); }); })()`;

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const pickerVisible = (page) => page.locator('text=Welcome to Vantage').first().isVisible().catch(() => false);

/**
 * Wait for the app shell to come back after a return-navigation. MainApp
 * re-mounts and re-fetches broker data on the way in, so this can take a while
 * (seconds on dev, ~1-3s on prod).
 */
async function waitForAppShell(page, timeoutMs = 45000, exclude = /Restore your target allocation/) {
  const start = Date.now();
  let picker = false;
  while (Date.now() - start < timeoutMs) {
    const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
    picker = /Welcome to Vantage/.test(txt);
    // `exclude` matches the sub-page's own copy — if it is still on screen we
    // never actually left the strategy route.
    if (txt.length > 400 && !exclude.test(txt)) return { rendered: true, picker };
    await page.waitForTimeout(1000);
  }
  return { rendered: false, picker };
}

async function robustClick(page, locator) {
  try { await locator.scrollIntoViewIfNeeded({ timeout: 5000 }); } catch {}
  try { await locator.click({ timeout: 8000 }); return true; } catch {}
  try { await locator.click({ timeout: 5000, force: true }); return true; } catch {}
  try {
    await locator.evaluate((el) => {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    });
    return true;
  } catch { return false; }
}

/** Click until the URL actually changes (dev compiles the target route on demand). */
async function clickAndWaitForUrlChange(page, locator, timeoutMs = 40000) {
  const before = page.url();
  const start = Date.now();
  let attempts = 0;
  while (Date.now() - start < timeoutMs) {
    if (page.url() !== before) return true;
    if (attempts < 3) { await robustClick(page, locator); attempts++; }
    await page.waitForTimeout(2500);
  }
  return page.url() !== before;
}

/** Drop the persistent opt-out so the next MainApp mount behaves like Em's session. */
async function dropOptOut(page) {
  await page.evaluate((k) => { try { localStorage.removeItem(k); } catch {} }, SKIP_KEY);
}

/** In-app (client-side) navigation into the rebalancing setup page. */
async function openRebalancing(page) {
  await page.goto(`${BASE}/?tab=invest`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  await dropOptOut(page);
  const card = page.getByText('Portfolio Rebalancing', { exact: true }).first();
  await card.waitFor({ state: 'visible', timeout: 60000 });
  return clickInAppCard(page, card);
}

/** Click an in-app card and wait (generously — dev compiles routes on first hit). */
async function clickInAppCard(page, card) {
  const start = Date.now();
  let clicked = false;
  while (Date.now() - start < 120000) {
    if (!new RegExp(`^${BASE}/$`).test(page.url())) return { clicked, url: page.url() };
    await robustClick(page, card);
    clicked = true;
    await page.waitForTimeout(3000);
  }
  return { clicked, url: page.url() };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: `sb-${REF}-auth-token`, value: COOKIE, domain: HOST, path: '/' }]);
  await ctx.addInitScript(AUTH_INIT, true);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 140)));

  // sanity: app boots into the shell, no picker
  await page.goto(`${BASE}/?tab=portfolio`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(6000);
  check('setup: app shell renders', !(await pickerVisible(page)));

  // ── Case 1: bottom "Cancel" (the reported path) ──
  const nav1 = await openRebalancing(page);
  check('setup: reached rebalancing via in-app nav', /rebalancing/.test(nav1.url), nav1.url);
  const cancelBtn = page.getByTestId('rebalance-cancel');
  await cancelBtn.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(4000); // let hydration settle
  await clickAndWaitForUrlChange(page, cancelBtn);
  await page.waitForTimeout(2000);
  const url1 = page.url();
  const shell1 = await waitForAppShell(page);
  const picker1 = shell1.picker || (await pickerVisible(page));
  const back1 = await page.evaluate(() => document.body.innerText);
  check('Cancel: leaves the rebalancing page', !/rebalancing/.test(url1), url1.replace(BASE, ''));
  check('Cancel: app shell comes back', shell1.rendered);
  check('Cancel: does NOT re-show the account picker', !picker1, `picker=${picker1}`);
  check('Cancel: lands on the tab it was launched from (Invest)', /ALL STRATEGIES/.test(back1), back1.slice(0, 60).replace(/\n+/g, ' | '));

  // ── Case 2: header "Back" ──
  const nav2 = await openRebalancing(page);
  const backBtn = page.getByRole('button', { name: 'Back', exact: true }).first();
  await backBtn.waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(4000);
  await clickAndWaitForUrlChange(page, backBtn);
  await page.waitForTimeout(2000);
  const url2 = page.url();
  const shell2 = await waitForAppShell(page);
  const picker2 = shell2.picker || (await pickerVisible(page));
  check('Back: app shell comes back', shell2.rendered);
  check('Back: does NOT re-show the account picker', !picker2, `picker=${picker2} url=${url2.replace(BASE, '')}`);

  // ── Case 3: Tax Loss Harvesting bottom "Cancel" (same helper, different page) ──
  await page.goto(`${BASE}/?tab=invest`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  await dropOptOut(page);
  const harvestCard = page.getByTestId('strategy-taxharvest');
  await harvestCard.waitFor({ state: 'visible', timeout: 60000 });
  const navH = await clickInAppCard(page, harvestCard);
  check('harvest: reached tax-harvesting via in-app nav', /tax-harvesting/.test(navH.url), navH.url.replace(BASE, ''));
  await page.waitForTimeout(6000);
  const harvestCancel = page.getByTestId('harvest-cancel');
  const hVisible = await harvestCancel.isVisible().catch(() => false);
  if (hVisible) {
    await clickAndWaitForUrlChange(page, harvestCancel);
    await page.waitForTimeout(2000);
    const shell4 = await waitForAppShell(page, 45000, /Offset gains and reduce your tax bill/);
    const picker4 = shell4.picker || (await pickerVisible(page));
    check('harvest Cancel: app shell comes back', shell4.rendered, page.url().replace(BASE, ''));
    check('harvest Cancel: does NOT re-show the account picker', !picker4, `picker=${picker4}`);
  }

  // ── Case 4: deep link / fresh tab (no in-app history) ──
  const fresh = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await fresh.addCookies([{ name: `sb-${REF}-auth-token`, value: COOKIE, domain: HOST, path: '/' }]);
  await fresh.addInitScript(AUTH_INIT, false);
  const p2 = await fresh.newPage();
  await p2.goto(`${BASE}/strategies/setup/rebalancing`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p2.waitForTimeout(7000);
  const b2 = p2.getByTestId('rebalance-cancel');
  const visible = await b2.isVisible().catch(() => false);
  check('deep link: rebalancing page renders standalone', visible);
  if (visible) {
    await p2.waitForTimeout(8000); // cold compile + hydration
    await clickAndWaitForUrlChange(p2, b2);
    await p2.waitForTimeout(2000);
    const url3 = p2.url();
    const shell3 = await waitForAppShell(p2);
    const picker3 = shell3.picker || (await pickerVisible(p2));
    check('deep link: lands inside the app (no browser-history dead end)',
      shell3.rendered && new URL(url3).origin === new URL(BASE).origin, url3.replace(BASE, ''));
    check('deep link: does NOT show the account picker', !picker3, `picker=${picker3}`);
  }
  await fresh.close();

  if (errs.length) console.log('page errors:\n' + errs.slice(0, 5).join('\n'));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
