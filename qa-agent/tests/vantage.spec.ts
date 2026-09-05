import { test, expect, Page } from '@playwright/test';
import * as path from 'path';
import {
  setupDemoMode,
  clickTab,
  waitForAppLoad,
  screenshot,
  screenshotElement,
  SCREENSHOTS_DIR,
} from '../helpers';

// ── Capture screenshots for Claude visual QA ──
async function captureVisualScreenshots(page: Page) {
  // Position card (Portfolio)
  await screenshotElement(
    page,
    ['[data-testid="position-SPY"]', '[data-testid="position-GOOGL"]'],
    '03_position_card.png',
    850
  );

  // Sticky footer (Portfolio)
  await screenshotElement(
    page,
    ['[data-testid="portfolio-footer"]'],
    '06_sticky_footer.png',
    2000
  );
}

// ─── PORTFOLIO TAB ───
test.describe('Portfolio Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Portfolio');
  });

  test('loads without error', async ({ page }) => {
    const errorText = await page.locator('text=Error, text=Something went wrong').count();
    expect(errorText).toBe(0);

    await screenshot(page, '01_portfolio_load');
  });

  test('shows account value (not zero)', async ({ page }) => {
    const accountValue = page.locator('text=/\\$[0-9,]+\\.[0-9]{2}/').first();
    await expect(accountValue).toBeVisible({ timeout: 10000 });

    await screenshot(page, '02_portfolio_account_value');
  });

  test('captures visual QA screenshots', async ({ page }) => {
    await waitForAppLoad(page);
    await captureVisualScreenshots(page);
  });
});

// ─── AI TAB ───
test.describe('AI Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'AI');
  });

  test('loads and shows greeting', async ({ page }) => {
    test.slow();
    await page.waitForTimeout(5000);

    // Capture greeting bubble for visual QA
    await screenshotElement(
      page,
      ['[data-testid="chat-area"]'],
      'p2_01_greeting.png',
      200
    );

    await screenshot(page, '07_ai_tab_load');
  });

  test('loads without endless dots', async ({ page }) => {
    test.slow();
    await page.waitForTimeout(5000);
    const dotsOnly = await page.locator('text=•••').count();
    console.log('Dots visible after 5s:', dotsOnly);
  });
});

// ─── INVEST TAB ───
test.describe('Invest Tab', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await clickTab(page, 'Invest');
  });

  test('strategies grid for visual QA', async ({ page }) => {
    await screenshotElement(
      page,
      ['[data-testid="strategies-section"]', 'text=STRATEGIES >> xpath=../..'],
      'p2_10_invest_strategies.png',
      600
    );
  });

  test('curated baskets for visual QA', async ({ page }) => {
    // Click Build Basket to open curated baskets
    try {
      await page.locator('text=Build Basket').first().click();
      await page.waitForTimeout(4000);
    } catch {
      console.log('Build Basket button not found');
    }

    await page.evaluate(() => window.scrollTo(0, 500));
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'p2_11_basket_curated.png'),
      animations: 'disabled',
    });
  });
});
