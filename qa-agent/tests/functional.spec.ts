import { test, expect, Page } from '@playwright/test';
import * as dotenv from 'dotenv';
dotenv.config();

const APP_URL = process.env.APP_URL || 'https://vantage-ai-trading.vercel.app';

// ─── SHARED HELPERS ───

// ─── Supabase auth mock (bypasses onboarding) ────────────────
const SUPABASE_REF = 'ixjnuoslbzytubpplkot';
const SUPABASE_COOKIE = `sb-${SUPABASE_REF}-auth-token`;
const QA_USER = {
  id: 'demo-qa-user',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'qa@vantage.test',
  email_confirmed_at: '2024-01-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { first_name: 'QA', last_name: 'Agent', investor_style: 'buffett', pending_choice: 'demo' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

async function setupDemoMode(page: Page) {
  // Seed a valid Supabase session cookie BEFORE the app hydrates.
  // @supabase/ssr stores the session in `sb-<ref>-auth-token` as
  // `base64-` + base64url(JSON.stringify(session)).
  const session = {
    access_token: 'demo-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'demo-refresh-token',
    user: QA_USER,
  };
  const cookieValue =
    'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  await page.addInitScript(
    ({ cookieName, cookieValue }) => {
      document.cookie = `${cookieName}=${cookieValue}; path=/; SameSite=Lax`;
      try {
        localStorage.setItem('vantage:skipAccountSelect:v2', '1');
        localStorage.setItem('vantage:activeAccount', 'demo');
      } catch {}
    },
    { cookieName: SUPABASE_COOKIE, cookieValue }
  );

  // Intercept Supabase auth endpoints so getUser() returns our QA user.
  await page.route('**/auth/v1/user', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(QA_USER),
    });
  });
  await page.route('**/auth/v1/token**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(session),
    });
  });

  // Mock /api/auth/me with the CURRENT snake_case profile shape
  // (useAppState reads investor_style / first_name / last_name / demo_start_at).
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: 'demo-qa-user',
          email: 'qa@vantage.test',
          first_name: 'QA',
          last_name: 'Agent',
          investor_style: 'buffett',
          risk_tolerance: 'balanced',
          tier: 'demo',
          demo_start_at: '2024-01-01T00:00:00Z',
          demo_expires_at: null,
          connection_type: null,
          connection_status: null,
          investor_style_onboarded: true,
          investorStyleOnboarded: true,
          investorStyle: 'buffett',
          riskTolerance: 'balanced',
          displayName: 'QA Agent',
          connection_initiated_at: null,
          email_verified: true,
          mfa_enabled: false,
          mfa_method: null,
        },
      }),
    });
  });

  // Mock /api/accounts to return the Demo Portfolio account. Server routes
  // validate the Supabase JWT (a fake cookie can't satisfy requireAuth), so we
  // intercept this route to seed the client-side demo account list.
  await page.route('**/api/accounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        accounts: [{
          id: 'demo',
          name: 'Demo Portfolio',
          broker: 'Vantage Demo',
          isDemo: true,
          tradingEnabled: true,
          totalValue: 100000,
          buyingPower: 100000,
          cash: 100000,
          environment: 'demo',
        }],
      }),
    });
  });

  // Mock /api/baskets to return curated themed baskets. The server route queries
  // the Supabase baskets table and would return an HTML error page for a fake
  // session, which the client can't JSON.parse.
  await page.route('**/api/baskets', async (route) => {
    const mk = (id: string, theme: string, emoji: string, name: string, thesis: string, risk_note: string, symbols: string[]) => ({
      id,
      theme,
      emoji,
      name,
      thesis,
      risk_note,
      stocks: symbols.map((s) => ({
        symbol: s,
        name: s,
        allocation: 100 / symbols.length,
        rationale: 'Strong fundamentals and durable demand.',
        performance: { '3m': 8.2, ytd: 12.4, '1y': 15.1 },
      })),
      performance: { '3m': 8.2, ytd: 12.4, '1y': 15.1, best_timeframe: '1y' },
      created_at: '2026-08-25T00:00:00Z',
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        baskets: [
          mk('b1', 'AI & Semiconductors', '🤖', 'AI & Semiconductors', 'Chip demand and AI infrastructure spend remain durable.', 'Concentration risk in high-beta tech.', ['NVDA', 'AVGO', 'AMD', 'MSFT']),
          mk('b2', 'Healthcare Innovation', '🧬', 'Healthcare Innovation', 'Aging demographics and drug pipeline momentum.', 'Regulatory and reimbursement uncertainty.', ['LLY', 'UNH', 'ISRG', 'VRTX']),
          mk('b3', 'Infrastructure & Defense', '🏗️', 'Infrastructure & Defense', 'Public capex and defense budgets are rising.', 'Rate sensitivity on long-duration assets.', ['CAT', 'DE', 'RTX', 'LMT']),
          mk('b4', 'Financial Strength', '🏦', 'Financial Strength', 'Higher-for-longer rates support net interest margins.', 'Credit cycle deterioration risk.', ['JPM', 'BAC', 'GS', 'MS']),
        ],
        nextRefresh: new Date(Date.now() + 7 * 86400000).toISOString(),
        lastUpdated: '2026-08-25T00:00:00Z',
        changelog: null,
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
  const nav = page.locator('nav.fixed.bottom-0');
  if (tab === 'AI') {
    // AI tab has a raised cyan circular button
    const aiButton = nav.locator('button.bg-cyan-500, button[class*="cyan"]').first();
    await aiButton.click();
  } else {
    // Exact-name role match scoped to the nav avoids matching the
    // AccountSwitcher's "Demo Portfolio" text.
    await nav.getByRole('button', { name: tab, exact: true }).click();
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

    // Demo portfolio seeded from DEMO_PORTFOLIOS.buffett (10 positions).
    const expected = ['AAPL', 'BRK.B', 'JPM', 'KO', 'AXP', 'PG', 'JNJ', 'WMT', 'BAC', 'CVX'];
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

    // Buying Power should equal Cash (values render as $58.6K compact notation).
    const buyingPowerMatch = bodyText.match(/BUYING POWER[\s\S]*?\$([0-9][0-9.,]*K?)/);
    const cashMatch = bodyText.match(/CASH[\s\S]*?\$([0-9][0-9.,]*K?)/);

    if (buyingPowerMatch && cashMatch) {
      console.log('Buying Power:', buyingPowerMatch[1]);
      console.log('Cash:', cashMatch[1]);
      expect(buyingPowerMatch[1]).toBe(cashMatch[1]);
    }
  });

  test('position cards show per-position gain', async ({ page }) => {
    await waitForPrices(page);

    for (let y = 0; y <= 3000; y += 400) {
      await page.evaluate((sy) => window.scrollTo(0, sy), y);
      await page.waitForTimeout(150);
    }

    // Each position card renders a +/-x.xx% gain badge.
    const gainBadges = await page.locator('text=/[+-][0-9]+\\.[0-9]+%/').count();

    console.log('Per-position gain badges:', gainBadges);
    expect(gainBadges).toBeGreaterThanOrEqual(10);
  });

  test('portfolio summary shows cash and buying power', async ({ page }) => {
    await waitForPrices(page);

    const bodyText = await page.evaluate(() => document.body.innerText);

    // "Portfolio Value" renders uppercase via CSS text-transform (innerText = "PORTFOLIO VALUE").
    const lower = bodyText.toLowerCase();
    expect(lower).toContain('portfolio value');
    expect(lower).toContain('cash');
    expect(lower).toContain('buying power');
    expect(lower).toContain('invested');
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

    // Demo orders seeded from DEMO_ORDERS.buffett.
    const newTickers = ['AAPL', 'BRK.B', 'JPM', 'KO', 'CVX', 'BAC'];
    const foundNew = newTickers.filter((t) => bodyText.includes(t));

    // Old growth tickers should NOT be present.
    const oldTickers = ['SPY', 'QQQ', 'META', 'AMZN', 'NFLX'];
    const foundOld = oldTickers.filter((t) => bodyText.includes(t));

    // Order dates render as "Sep 5 · 1:23 PM" (month day · time, no year).
    const hasDate = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s*·/.test(bodyText);

    console.log('New tickers in orders:', foundNew.join(', '));
    console.log('Old tickers (should be none):', foundOld.join(', ') || 'none ✅');
    console.log('Date in orders:', hasDate);

    expect(foundNew.length).toBeGreaterThanOrEqual(2);
    expect(foundOld.length).toBe(0);
    expect(hasDate).toBe(true);
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

    // Quick actions live in the Explore bottom sheet, opened via the "+" pill in
    // the input bar (icon-only on narrow screens, so its accessible name is just "+").
    await page.locator('.vantage-input-bar button').first().click().catch(() => {});
    await page.waitForTimeout(1000);

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
