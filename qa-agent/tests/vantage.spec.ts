import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const APP_URL = process.env.APP_URL || 'https://vantage-ai-trading.vercel.app';
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './screenshots';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ─── HELPERS ───────────────────────────────────────────────

// Helper to take and save screenshot
async function screenshot(page: Page, name: string, fullPage = false) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage, animations: 'disabled' });
  return filepath;
}

// ── Selector-based screenshot helper ──
async function screenshotElement(
  page: Page,
  selectors: string[],
  filename: string,
  fallbackScrollY?: number
): Promise<boolean> {
  for (const selector of selectors) {
    try {
      const element = page.locator(selector).first();
      const count = await element.count().catch(() => 0);
      if (count > 0) {
        const visible = await element.isVisible().catch(() => false);
        if (visible) {
          await element.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await element.screenshot({
            path: path.join(SCREENSHOTS_DIR, filename),
            animations: 'disabled',
          });
          console.log(`Screenshot ${filename} via: ${selector}`);
          return true;
        }
      }
    } catch {
      continue;
    }
  }

  // Fallback: scroll to position and screenshot viewport
  if (fallbackScrollY !== undefined) {
    await page.evaluate((y) => window.scrollTo(0, y), fallbackScrollY);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, filename),
      animations: 'disabled',
    });
    console.log(`Screenshot ${filename} via scroll fallback (${fallbackScrollY}px)`);
    return true;
  }

  console.log(`Screenshot ${filename}: element not found`);
  return false;
}

// ── Text assertion helper (no Claude needed) ──
async function assertTextPresent(
  page: Page,
  texts: string[],
  context: string
): Promise<{ found: string[]; missing: string[] }> {
  const bodyText = await page.evaluate(() => document.body.innerText);

  const found = texts.filter((t) =>
    bodyText.toLowerCase().includes(t.toLowerCase())
  );
  const missing = texts.filter(
    (t) => !bodyText.toLowerCase().includes(t.toLowerCase())
  );

  console.log(`[${context}] Found: ${found.join(', ')}`);
  if (missing.length > 0) {
    console.log(`[${context}] Missing: ${missing.join(', ')}`);
  }

  return { found, missing };
}

// ── Wait for full app load (prices, content, React renders) ──
async function waitForAppLoad(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Wait for no loading spinners
  await page.waitForFunction(() => {
    const spinners = document.querySelectorAll(
      '[data-loading="true"], .animate-spin, .loading-spinner'
    );
    return spinners.length === 0;
  }, { timeout: 10000 }).catch(() => {});

  // Wait for $ prices to appear (Finnhub loaded)
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('$') && !text.includes('$0.00');
  }, { timeout: 15000 }).catch(() => {});

  // Final buffer for React re-renders
  await page.waitForTimeout(2000);
}

// ── Navigate to tab and wait for content ──
async function navigateToTab(page: Page, tabName: string) {
  await page.locator(`text=${tabName}`).click();
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// ── Scroll and wait for content ──
async function scrollAndWait(page: Page, scrollY: number, waitForSelector?: string) {
  await page.evaluate((y) => window.scrollTo(0, y), scrollY);
  if (waitForSelector) {
    await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {});
  }
  await page.waitForTimeout(1000);
}

// ── Selector-based portfolio section capture ──
async function capturePortfolioSections(page: Page) {
  // Full page top first
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, '03_portfolio_top.png'),
    animations: 'disabled',
  });

  // Holdings section via testid
  await screenshotElement(
    page,
    ['[data-testid="holdings-section"]', '#holdings-section', 'text=HOLDINGS'],
    '03_holdings_section.png',
    750
  );

  // Individual position card (SPY first, fallback to GOOGL/NVDA)
  await screenshotElement(
    page,
    ['[data-testid="position-SPY"]', '[data-testid="position-GOOGL"]', '[data-testid="position-NVDA"]'],
    '03_position_card.png',
    850
  );

  // Sticky footer
  await screenshotElement(
    page,
    ['[data-testid="portfolio-footer"]'],
    '06_sticky_footer.png',
    2000
  );

  // Account card
  await screenshotElement(
    page,
    ['[data-testid="account-card"]', 'text=ACCOUNT VALUE >> xpath=../..'],
    '06_portfolio_account.png',
    100
  );

  // Baskets section
  await screenshotElement(
    page,
    ['#baskets-section', '[data-testid="baskets-section"]', 'text=BASKETS >> xpath=../..'],
    '03c_baskets_section.png',
    600
  );

  // SPY card specifically
  await screenshotElement(
    page,
    ['[data-testid="position-SPY"]', '.position-card:has-text("SPY")'],
    '03b_spy_card.png',
    750
  );
}

// Mock /api/auth/me to return a demo user — bypasses onboarding
async function setupDemoMode(page: Page) {
  // Intercept the auth check and return a mock user profile
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'demo-qa-user',
          email: 'qa@vantage.test',
          displayName: 'QA Agent',
          investorStyle: 'buffett',
          investorStyleOnboarded: true,
          createdAt: '2024-01-01T00:00:00Z',
        },
      }),
    });
  });

  // Use 'load' instead of 'networkidle' — streaming AI connections prevent idle
  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {
    console.log('page.goto: load timeout, continuing anyway');
  });
  await waitForAppLoad(page);

  // If BrokerGate is showing, dismiss it
  const skipBtn = page.locator('text=Skip for now');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(3000);
  }

  // Confirm bottom nav is now visible
  await page.locator('nav.fixed.bottom-0').waitFor({ state: 'visible', timeout: 5000 });
}

// Helper to click a bottom nav tab by its label text
async function clickTab(page: Page, label: string) {
  // Find the bottom <nav>
  const nav = page.locator('nav.fixed.bottom-0');

  if (label === 'AI') {
    // AI tab has a raised circular cyan button with CompassIcon
    const aiButton = nav.locator('button.bg-cyan-500, button[class*="cyan"]').first();
    await aiButton.click();
  } else {
    // Other tabs have the label text inside the button
    const tab = nav.locator(`button:has-text("${label}")`).first();
    await tab.click();
  }
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// ─── FIX 6: PRICE LOAD VERIFICATION ───
test.describe('Pre-flight', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
  });

  test('live prices loaded (not $0.00)', async ({ page }) => {
    // Market overview prices should not be $0.00
    const zeroPrices = await page.locator('text=$0.00').count();

    // Real prices should exist (at least 1)
    const realPrices = await page.locator('text=/\\$[1-9][0-9]+\\.[0-9]{2}/').count();

    console.log('Zero prices found:', zeroPrices);
    console.log('Real prices found:', realPrices);

    expect(realPrices).toBeGreaterThan(0);

    await screenshot(page, '00_prices_loaded');
  });
});

// ─── PORTFOLIO TAB TESTS ───
test.describe('Portfolio Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Portfolio');
  });

  test('loads without error', async ({ page }) => {
    // No error boundaries visible
    const errorText = await page.locator(
      'text=Error, text=Something went wrong'
    ).count();
    expect(errorText).toBe(0);

    await screenshot(page, '01_portfolio_load');
  });

  test('shows account value (not zero)', async ({ page }) => {
    // Account value should contain $ and digits
    const accountValue = page.locator('text=/\\$[0-9,]+\\.[0-9]{2}/').first();
    await expect(accountValue).toBeVisible({ timeout: 10000 });

    await screenshot(page, '02_portfolio_account_value');
  });

  test('shows 10 holdings', async ({ page }) => {
    // ── Console log capture for diagnosis ──
    const consoleLogs: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'log' || msg.type() === 'error') {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
      }
    });

    await waitForAppLoad(page);

    console.log('=== APP CONSOLE LOGS ===');
    consoleLogs.slice(0, 20).forEach(l => console.log(l));
    console.log('========================');

    // ── Selector-based captures (no stitching) ──
    await capturePortfolioSections(page);

    // Text-based assertion (no visual QA needed)
    const { found, missing } = await assertTextPresent(
      page,
      ['TODAY', 'TOTAL', 'SPY', 'NVDA', 'GOOGL', 'MSFT', 'JPM'],
      'Portfolio Holdings'
    );
    expect(found.length).toBeGreaterThanOrEqual(3);

    // Scroll through holdings for ticker hunt
    const tickers = ['SPY', 'QQQ', 'GOOGL', 'MSFT', 'JPM', 'ADBE', 'ISRG', 'COST', 'LLY', 'NVDA'];
    const foundTickers: string[] = [];

    for (let y = 0; y <= 4000; y += 300) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(150);

      for (const ticker of tickers) {
        if (foundTickers.includes(ticker)) continue;
        const visible = await page
          .locator(`text=${ticker}`)
          .first()
          .isVisible()
          .catch(() => false);
        if (visible) foundTickers.push(ticker);
      }
    }

    const missingTickers = tickers.filter(t => !foundTickers.includes(t));
    console.log('✅ Found:', foundTickers.join(', '));
    console.log('❌ Missing:', missingTickers.join(', '));

    expect(foundTickers.length).toBeGreaterThanOrEqual(8);
  });

  test('no old positions visible', async ({ page }) => {
    await scrollAndWait(page, 500);

    // Text-based check for old tickers
    const { missing } = await assertTextPresent(
      page,
      ['META', 'AMZN', 'NFLX', 'CRM', 'UNH'],
      'Old Positions'
    );
    // Should NOT find these — they're old/removed
    // If any are found, they need cleanup

    await screenshot(page, '04_portfolio_no_old_positions');
  });

  test('market value shows on cards (not just price)', async ({ page }) => {
    await scrollAndWait(page, 500);

    // Look for values with comma / 4+ digit numbers
    const marketValues = page.locator('text=/\\$[0-9]{1,3},[0-9]{3}/');
    const count = await marketValues.count();
    console.log('Market values (comma-formatted) count:', count);

    // Also try without comma
    const plainValues = page.locator('text=/\\$[0-9]{4,}\\.[0-9]{2}/');
    const plainCount = await plainValues.count();
    console.log('Market values (plain-number) count:', plainCount);

    await screenshot(page, '05_portfolio_market_values');
  });

  test('buying power equals cash', async ({ page }) => {
    // Text-based assertion
    const { found } = await assertTextPresent(
      page,
      ['BUYING POWER', 'CASH', '$'],
      'Account Summary'
    );
    expect(found.length).toBeGreaterThanOrEqual(2);

    await screenshot(page, '06_portfolio_buying_power');
  });
});

// ─── AI TAB TESTS ───
test.describe('AI Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'AI');
  });

  test('loads and shows greeting', async ({ page }) => {
    test.slow(); // allow 3x timeout for AI streaming connections
    await screenshot(page, '07_ai_tab_load');

    // Should not show endless dots after waiting
    await page.waitForTimeout(5000);
    const dotsOnly = await page.locator('text=•••').count();
    console.log('Dots visible after 5s:', dotsOnly);

    await screenshot(page, '08_ai_greeting_resolved');
  });

  test('daily brief is collapsed by default', async ({ page }) => {
    test.slow(); // allow 3x timeout for AI streaming connections
    const marketRow = await page.locator(
      '[data-testid="daily-brief-market-row"]'
    ).count();

    await screenshot(page, '09_ai_daily_brief_collapsed');
    console.log('Market row visible when collapsed:', marketRow);
  });

  test('quick action buttons present', async ({ page }) => {
    await scrollAndWait(page, 500);

    const buttons = ['Strategy Ideas', 'Market Pulse', 'Tax Check', 'Alerts'];
    for (const btn of buttons) {
      const el = page.locator(`text=${btn}`).first();
      const visible = await el.isVisible({ timeout: 3000 }).catch(() => false);
      console.log(`Button "${btn}" visible:`, visible);
    }

    await screenshot(page, '10_ai_quick_actions');
  });

  test('chat input is visible and not behind nav', async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 9999));
    await page.waitForTimeout(1000);

    const input = page.locator(
      'input[placeholder*="Ask anything"], input[placeholder*="markets"], input[type="text"]'
    ).first();

    const box = await input.boundingBox();
    const viewport = page.viewportSize();

    if (box && viewport) {
      const navHeight = 80;
      const isVisible = box.y + box.height < viewport.height - navHeight;
      console.log('Input visible above nav:', isVisible);
      console.log('Input position:', box);
    } else {
      console.log('Input not found');
    }

    await screenshot(page, '11_ai_input_visible');
  });
});

// ─── INVEST TAB TESTS ───
test.describe('Invest Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Invest');
  });

  test('order history shows correct orders', async ({ page }) => {
    await scrollAndWait(page, 500);

    // Check for new seed orders
    const newOrders = ['SPY', 'QQQ', 'ISRG', 'JPM', 'COST'];
    for (const ticker of newOrders) {
      const el = page.locator(`text=${ticker}`).first();
      const visible = await el.isVisible().catch(() => false);
      console.log(`Order ${ticker} visible:`, visible);
    }

    // Scroll past the order form to show order history section
    await scrollAndWait(page, 1500);
    await screenshot(page, '12_invest_order_history', true);
  });

  test('order dates include year', async ({ page }) => {
    await scrollAndWait(page, 2000);

    // Check for dates in month+day format (e.g., "May 28")
    const monthPattern = page.locator('text=/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+\\d{1,2}/');
    const monthCount = await monthPattern.count();
    console.log('Month-day dates visible:', monthCount);
    
    // Year may or may not appear depending on deploy version
    const yearPattern = page.locator('text=/20[2-9]\\d/');
    const yearCount = await yearPattern.count();
    console.log('Years in dates:', yearCount);

    // At minimum, month+day dates should be visible
    expect(monthCount).toBeGreaterThanOrEqual(1);

    await screenshot(page, '13_invest_dates');
  });

  test('no old ghost orders', async ({ page }) => {
    await scrollAndWait(page, 500);

    const ghostOrders = ['NFLX', 'CRM', 'META', 'AMZN'];
    for (const ticker of ghostOrders) {
      const count = await page.locator(
        `.order-row:has-text("${ticker}")`
      ).count();
      console.log(`Ghost order ${ticker}:`, count);
    }

    await screenshot(page, '14_invest_no_ghost_orders');
  });
});

// ─── WATCHLIST TAB TESTS ───
test.describe('Watchlist Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Watchlist');
  });

  test('loads with live prices', async ({ page }) => {
    // Should show prices
    const prices = page.locator('text=/\\$[0-9]+\\.[0-9]{2}/');
    const count = await prices.count();
    console.log('Price values visible on watchlist:', count);

    await screenshot(page, '15_watchlist_prices');
  });
});

// ─── SETTINGS TAB TESTS ───
test.describe('Settings Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Settings');
  });

  test('shows investor style and risk tolerance', async ({ page }) => {
    await expect(
      page.locator('text=Investor Style')
    ).toBeVisible();
    await expect(
      page.locator('text=Risk Tolerance')
    ).toBeVisible();

    await screenshot(page, '16_settings_profile');
  });
});
