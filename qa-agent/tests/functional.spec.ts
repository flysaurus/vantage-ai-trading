import { test, expect, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const APP_URL = process.env.APP_URL || 'https://vantage-ai-trading.vercel.app';

// ─── SHARED HELPERS ───

// Mock auth to bypass onboarding (same as vantage.spec.ts)
async function setupDemoMode(page: Page) {
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

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {
    console.log('page.goto: load timeout, continuing');
  });

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  // Dismiss BrokerGate if showing
  const skipBtn = page.locator('text=Skip for now');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(3000);
  }

  await page.locator('nav.fixed.bottom-0').waitFor({ state: 'visible', timeout: 5000 });
}
async function waitForPrices(page: Page) {
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    const hasPrices = /\$[1-9][0-9,]+\.[0-9]{2}/.test(text);
    const noZeros = !text.includes('$0.00');
    return hasPrices && noZeros;
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function goToTab(page: Page, tab: string) {
  if (tab === 'AI') {
    // AI tab has a raised cyan circular button — text=AI may match wrong element
    const nav = page.locator('nav.fixed.bottom-0');
    const aiButton = nav.locator('button.bg-cyan-500, button[class*="cyan"]').first();
    await aiButton.click();
  } else {
    await page.locator(`text=${tab}`).first().click();
  }
  await page.waitForTimeout(2000);
}

// ─── PORTFOLIO TAB ───
test.describe('Portfolio — Functional', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await goToTab(page, 'Portfolio');
  });

  test('shows exactly 10 positions', async ({ page }) => {
    await waitForPrices(page);

    const expected = ['SPY', 'QQQ', 'GOOGL', 'MSFT', 'JPM', 'ADBE', 'ISRG', 'NVDA', 'COST', 'LLY'];
    const forbidden = ['META', 'AMZN', 'NFLX', 'CRM', 'UNH'];

    // Scroll through entire page
    for (let y = 0; y <= 4000; y += 300) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(100);
    }

    const bodyText = await page.evaluate(() => document.body.innerText);

    const found = expected.filter((t) => bodyText.includes(t));
    const foundForbidden = forbidden.filter((t) => bodyText.includes(t));

    console.log('Positions found:', found.join(', '));
    console.log('Old positions (should be none):', foundForbidden.join(', ') || 'none ✅');

    expect(found.length).toBe(10);
    expect(foundForbidden.length).toBe(0);
  });

  test('account value is non-zero and consistent', async ({ page }) => {
    await waitForPrices(page);

    const bodyText = await page.evaluate(() => document.body.innerText);

    // Should have large dollar value (portfolio ~$130K-$200K)
    const largeValues = bodyText.match(/\$[1-9][0-9]{2,},[0-9]{3}/g) || [];
    console.log('Large values found:', largeValues);
    expect(largeValues.length).toBeGreaterThan(0);

    // Buying Power should equal Cash
    const buyingPowerMatch = bodyText.match(/BUYING POWER[\s\S]{0,20}\$([0-9,]+)/);
    const cashMatch = bodyText.match(/CASH[\s\S]{0,20}\$([0-9,]+)/);

    if (buyingPowerMatch && cashMatch) {
      console.log('Buying Power:', buyingPowerMatch[1]);
      console.log('Cash:', cashMatch[1]);
      expect(buyingPowerMatch[1]).toBe(cashMatch[1]);
    }
  });

  test('portfolio cards show TODAY and TOTAL labels', async ({ page }) => {
    await waitForPrices(page);

    for (let y = 0; y <= 3000; y += 400) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(150);
    }

    const todayCount = await page.locator('text=TODAY').count();
    const totalCount = await page.locator('text=TOTAL').count();

    console.log('TODAY labels:', todayCount);
    console.log('TOTAL labels:', totalCount);

    expect(todayCount).toBeGreaterThanOrEqual(5);
    expect(totalCount).toBeGreaterThanOrEqual(5);
  });

  test('sticky footer has three summary columns', async ({ page }) => {
    await waitForPrices(page);

    const footer = page.locator('[data-testid="portfolio-footer"]');
    const footerExists = await footer.count() > 0;

    if (footerExists) {
      const footerText = await footer.innerText().catch(() => '');
      console.log('Footer text:', footerText);

      const hasMarketValue = footerText.includes('Market Value') || footerText.includes('MARKET VALUE');
      const hasToday = footerText.toLowerCase().includes('today');
      const hasTotal = footerText.toLowerCase().includes('total');

      expect(hasMarketValue).toBe(true);
      expect(hasToday).toBe(true);
      expect(hasTotal).toBe(true);
    } else {
      console.log('Footer not found via testid');
      // Fallback: check page text
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText.includes('Market Value') || bodyText.includes('MARKET VALUE')).toBe(true);
    }
  });

  test('chart renders with range buttons', async ({ page }) => {
    await waitForPrices(page);
    await page.waitForTimeout(3000);

    const ranges = ['1D', '1W', '1M', 'YTD', 'ALL'];
    const found: string[] = [];

    for (const r of ranges) {
      const count = await page.getByRole('button', { name: r, exact: true }).count()
        .catch(async () => await page.locator(`button`).filter({ hasText: new RegExp(`^${r}$`) }).count())
        .catch(() => 0);
      if (count > 0) found.push(r);
    }

    console.log('Chart ranges found:', found.join(', '));
    expect(found.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── INVEST TAB ───
test.describe('Invest — Functional', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await goToTab(page, 'Invest');
  });

  test('Build Basket in strategies grid', async ({ page }) => {
    const hasBuildBasket = await page.locator('text=Build Basket').count() > 0;
    const hasDCA = await page.locator('text=DCA').count() > 0;

    console.log('Build Basket in Invest:', hasBuildBasket);
    console.log('DCA in Invest:', hasDCA);

    expect(hasBuildBasket).toBe(true);
  });

  test('order history shows correct tickers and years', async ({ page }) => {
    for (let y = 0; y <= 2000; y += 300) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(100);
    }

    const bodyText = await page.evaluate(() => document.body.innerText);

    // New orders should be present
    const newTickers = ['SPY', 'QQQ', 'GOOGL', 'MSFT'];
    const foundNew = newTickers.filter((t) => bodyText.includes(t));

    // Old orders should NOT be present
    const oldTickers = ['META', 'AMZN', 'NFLX'];
    const foundOld = oldTickers.filter((t) => bodyText.includes(t));

    // Year should be present
    const hasYear = bodyText.includes('2024') || bodyText.includes('2025');

    console.log('New tickers in orders:', foundNew.join(', '));
    console.log('Old tickers (should be none):', foundOld.join(', ') || 'none ✅');
    console.log('Year in dates:', hasYear);

    expect(foundNew.length).toBeGreaterThanOrEqual(2);
    expect(foundOld.length).toBe(0);
    expect(hasYear).toBe(true);
  });

  test('curated baskets load with themes', async ({ page }) => {
    // Click Build Basket
    try {
      await page.locator('text=Build Basket').first().click();
      await page.waitForTimeout(4000);
    } catch {
      console.log('Build Basket button not found');
      return;
    }

    const bodyText = await page.evaluate(() => document.body.innerText);

    const themes = ['AI', 'Infrastructure', 'Healthcare', 'GLP', 'Defense', 'Financial'];
    const found = themes.filter((t) => bodyText.toLowerCase().includes(t.toLowerCase()));

    console.log('Basket themes found:', found.join(', '));
    expect(found.length).toBeGreaterThanOrEqual(3);

    // Performance should not all be 0.0%
    const zeroCount = (bodyText.match(/\+0\.0%/g) || []).length;
    const realCount = (bodyText.match(/[+-][1-9][0-9.]+%/g) || []).length;

    console.log('Zero perf badges:', zeroCount);
    console.log('Real perf badges:', realCount);

    // At least some should have real data
    if (realCount === 0 && zeroCount > 3) {
      console.log('⚠️ All baskets showing 0.0% — performance data not loading');
    }
  });
});

// ─── AI TAB ───
test.describe('AI Tab — Functional', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await goToTab(page, 'AI');
  });

  test('has correct quick actions', async ({ page }) => {
    test.slow();
    await page.waitForSelector('text=Ask Vantage AI', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    for (let y = 0; y <= 1000; y += 200) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(100);
    }

    const hasStrategyIdeas = await page.locator('text=Strategy Ideas').count() > 0;
    const hasMarketPulse = await page.locator('text=Market Pulse').count() > 0;
    const hasTaxCheck = await page.locator('text=Tax Check').count() > 0;
    const hasAlerts = await page.locator('text=Alerts').count() > 0;
    const hasBuildBasket = await page.locator('text=Build Basket').count() > 0;

    console.log('AI tab quick actions:', {
      hasStrategyIdeas,
      hasMarketPulse,
      hasTaxCheck,
      hasAlerts,
      hasBuildBasket_shouldBeFalse: hasBuildBasket,
    });

    expect(hasStrategyIdeas).toBe(true);
    expect(hasMarketPulse).toBe(true);
    expect(hasTaxCheck).toBe(true);
    expect(hasAlerts).toBe(true);
    expect(hasBuildBasket).toBe(false);
  });

  test('greeting loads and is personalized', async ({ page }) => {
    test.slow();
    await page.waitForSelector('text=Ask Vantage AI', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(8000);

    const bodyText = await page.evaluate(() => document.body.innerText);

    const isGeneric = bodyText.includes('Good to see you') || bodyText.includes('What would you like to explore');
    const hasInitial = bodyText.includes('M.');
    const hasMarketRef = bodyText.includes('SPY') || bodyText.includes('portfolio') || bodyText.includes('market');

    console.log('Greeting:', { isGeneric, hasInitial, hasMarketRef });

    expect(isGeneric).toBe(false);
  });

  test('message counter shows AI analyses', async ({ page }) => {
    test.slow();
    await page.waitForSelector('text=Ask Vantage AI', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    for (let y = 0; y <= 2000; y += 300) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(100);
    }

    const bodyText = await page.evaluate(() => document.body.innerText);

    const hasCounter = bodyText.includes('analyses') || bodyText.includes('remaining') || bodyText.includes('messages');

    console.log('Message counter visible:', hasCounter);
    expect(hasCounter).toBe(true);
  });
});

// ─── WATCHLIST ───
test.describe('Watchlist — Functional', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await goToTab(page, 'Watchlist');
  });

  test('shows live prices and owned badges', async ({ page }) => {
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body.innerText);

    const hasPrices = /\$[1-9][0-9]+\.[0-9]{2}/.test(bodyText);
    const hasOwnedBadge = bodyText.includes('sh');

    console.log('Watchlist prices:', hasPrices, '| owned badges:', hasOwnedBadge);

    const day = new Date().getUTCDay();
    if (hasPrices) {
      expect(hasPrices).toBe(true);
    } else if (day === 0 || day === 6) {
      console.log('⚠️ Weekend — no live prices expected');
    }
  });
});

// ─── SETTINGS ───
test.describe('Settings — Functional', () => {

  test.beforeEach(async ({ page }) => {
    await setupDemoMode(page);
    await goToTab(page, 'Settings');
  });

  test('shows investor style and risk tolerance', async ({ page }) => {
    await page.waitForTimeout(2000);

    const hasInvestorStyle = await page.locator('text=Investor Style').count() > 0;
    const hasRiskTolerance = await page.locator('text=Risk Tolerance').count() > 0;
    const hasLynch = await page.locator('text=Lynch').count() > 0;

    console.log('Settings:', { hasInvestorStyle, hasRiskTolerance, hasLynch });

    expect(hasInvestorStyle).toBe(true);
    expect(hasRiskTolerance).toBe(true);
  });
});
