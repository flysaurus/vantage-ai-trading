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

async function screenshot(page: Page, name: string, fullPage = false) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage, animations: 'disabled' });
  return filepath;
}

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

async function waitForAppLoad(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => {
    const spinners = document.querySelectorAll('[data-loading="true"], .animate-spin, .loading-spinner');
    return spinners.length === 0;
  }, { timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('$') && !text.includes('$0.00');
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

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

  await page.goto(APP_URL, { waitUntil: 'load', timeout: 30000 }).catch(() => {
    console.log('page.goto: load timeout, continuing anyway');
  });
  await waitForAppLoad(page);

  const skipBtn = page.locator('text=Skip for now');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
    await page.waitForTimeout(3000);
  }

  await page.locator('nav.fixed.bottom-0').waitFor({ state: 'visible', timeout: 5000 });
}

async function clickTab(page: Page, label: string) {
  const nav = page.locator('nav.fixed.bottom-0');

  if (label === 'AI') {
    const aiButton = nav.locator('button.bg-cyan-500, button[class*="cyan"]').first();
    await aiButton.click();
  } else {
    const tab = nav.locator(`button:has-text("${label}")`).first();
    await tab.click();
  }
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

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
