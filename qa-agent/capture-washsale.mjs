// wash-sale e2e capture v3: inject REAL session cookie → drive Sell ticket → screenshot banner states.
// Run from project root: node washsale-capture.mjs
import { chromium } from 'playwright';
import * as fs from 'fs';

const APP_URL = 'http://localhost:3002';
const OUT = '/root/projects/vantage/qa-agent/screenshots-washsale';
const SUPABASE_REF = 'ixjnuoslbzytubpplkot';
const COOKIE_NAME = `sb-${SUPABASE_REF}-auth-token`;
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const s = JSON.parse(fs.readFileSync('/tmp/ws-session.json', 'utf8'));
const session = {
  access_token: s.access_token,
  token_type: 'bearer',
  expires_in: s.expires_at - Math.floor(Date.now() / 1000),
  expires_at: s.expires_at,
  refresh_token: s.refresh_token,
  user: s.user,
};
const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
console.log('cookie len', cookieValue.length, 'user', s.user.id);

async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, animations: 'disabled' });
  console.log('📸', p);
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 393, height: 851 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  await context.addInitScript(({ cookieName, cookieValue }) => {
    document.cookie = `${cookieName}=${cookieValue}; path=/; SameSite=Lax`;
    try {
      localStorage.setItem('vantage:skipAccountSelect:v2', '1');
      localStorage.setItem('vantage:activeAccount', 'demo');
    } catch {}
  }, { cookieName: COOKIE_NAME, cookieValue });

  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

  console.log('→ navigating to /');
  await page.goto(`${APP_URL}/`, { waitUntil: 'load', timeout: 30000 }).catch(() => console.log('goto timeout'));
  await page.waitForTimeout(2500);
  await page.locator('nav.fixed.bottom-0').waitFor({ state: 'visible', timeout: 25000 }).catch(() => console.log('nav not found'));
  await page.locator('text=Skip for now').first().click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(2500);
  console.log('URL:', page.url());

  // Go to Portfolio tab
  const nav = page.locator('nav.fixed.bottom-0');
  await nav.getByRole('button', { name: 'Portfolio', exact: true }).click().catch(async () => {
    await page.getByText('Portfolio', { exact: true }).first().click();
  });
  await page.waitForTimeout(2500);
  await page.getByText('AAPL', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => console.log('AAPL not visible'));
  await page.getByText('MSFT', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => console.log('MSFT not visible'));
  await shot(page, '02-portfolio');

  // ── Card expand/collapse state tracking (only one expanded at a time) ──
  let expandedSymbol = null;
  async function setExpanded(symbol) {
    if (expandedSymbol === symbol) return;
    if (expandedSymbol) {
      const cur = page.locator('.pcv3-header', { hasText: expandedSymbol }).first();
      await cur.scrollIntoViewIfNeeded().catch(() => {});
      await cur.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const hdr = page.locator('.pcv3-header', { hasText: symbol }).first();
    await hdr.scrollIntoViewIfNeeded().catch(() => {});
    await hdr.click().catch(() => {});
    await page.waitForTimeout(700);
    expandedSymbol = symbol;
  }
  async function openSellTicket(symbol) {
    console.log(`→ opening Sell ticket for ${symbol}`);
    await setExpanded(symbol);
    const sellBtn = page.getByRole('button', { name: 'Sell', exact: true }).first();
    await sellBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => console.log('  Sell btn not visible'));
    await sellBtn.click().catch(() => console.log('  Sell click failed'));
    await page.waitForTimeout(1500);
  }

  // ── wash-sale settle helper: wait for response, log verdict, count banner ──
  async function settleWashSale(expectBanner) {
    let resp = null;
    try {
      resp = await page.waitForResponse(r => r.url().includes('/api/wash-sale'), { timeout: 15000 });
    } catch { console.log('  (no wash-sale response within 15s)'); }
    let verdict = null;
    if (resp) {
      try { verdict = await resp.json(); } catch {}
      console.log('  wash-sale verdict:', JSON.stringify({
        status: resp.status(),
        isWashSale: verdict?.isWashSale,
        isLoss: verdict?.isLoss,
        fifoCostBasis: verdict?.fifoCostBasis,
        matchedQty: verdict?.matchedQty,
        hasLots: verdict?.hasLots,
        recentBuy: verdict?.recentBuy,
      }));
    }
    await page.waitForTimeout(600);
    const count = await page.getByText('Wash-sale advisory', { exact: true }).count();
    console.log(`  banner count: ${count} (expect ${expectBanner ? '1' : '0'})`);
    return { verdict, count };
  }

  async function setLimitAndQty(limitPrice, qty) {
    await page.getByRole('button', { name: 'Limit', exact: true }).first().click();
    await page.waitForTimeout(500);
    const numInputs = page.locator('input[type="number"]');
    // wait for limit price input to appear
    await numInputs.nth(1).waitFor({ state: 'visible', timeout: 5000 }).catch(() => console.log('  limit input not visible'));
    const cnt = await numInputs.count();
    console.log('  number inputs:', cnt);
    if (cnt >= 2) await numInputs.nth(1).fill(String(limitPrice));
    else await numInputs.first().fill(String(limitPrice));
    await numInputs.first().fill(String(qty));
  }

  // ══ Scenario 1: AAPL loss (limit 90) + recent buy → BANNER ══
  await openSellTicket('AAPL');
  await setLimitAndQty(90, 5);
  await settleWashSale(true);
  await shot(page, '03-aapl-loss-recent-buy-BANNER');

  // ══ Scenario 2: AAPL gain (limit 110) + recent buy → NO banner (same ticket) ══
  {
    const numInputs = page.locator('input[type="number"]');
    await numInputs.nth(1).fill('110');
    await settleWashSale(false);
    await shot(page, '04-aapl-gain-recent-buy-NO-banner');
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.waitForTimeout(800);

  // ══ Scenario 3: MSFT loss (limit 90) + NO recent buy → NO banner ══
  await openSellTicket('MSFT');
  await setLimitAndQty(90, 5);
  await settleWashSale(false);
  await shot(page, '05-msft-loss-no-buy-NO-banner');
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.waitForTimeout(800);

  // ══ Scenario 4: Confirm button ENABLED while banner shows (non-blocking proof) ══
  await openSellTicket('AAPL');
  await setLimitAndQty(90, 5);
  await settleWashSale(true);
  const confirmBtn = page.locator('button:has-text("Sell")').last();
  const confirmDisabled = await confirmBtn.isDisabled().catch(() => null);
  const confirmText = (await confirmBtn.textContent().catch(() => '')).trim();
  console.log('  [4] Confirm disabled?', confirmDisabled, '| text:', confirmText);
  await shot(page, '06-confirm-enabled-while-banner');

  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
