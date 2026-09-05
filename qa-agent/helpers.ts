// ───────────────────────────────────────────────────────────────
// qa-agent/helpers.ts — shared Playwright helpers.
//
// Single source of truth for: app URL, Supabase auth mock (demo login),
// tab navigation, screenshots, and the primitive screen actions used by
// the capture_screenshot tool. Both the Playwright specs and the
// standalone capture tool import from here so login logic is never
// duplicated.
// ───────────────────────────────────────────────────────────────
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

export const APP_URL = process.env.APP_URL || 'https://vantage-ai-trading.vercel.app';
export const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './screenshots';

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// ── Screenshot helpers ─────────────────────────────────────────

export async function screenshot(page: Page, name: string, fullPage = false) {
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage, animations: 'disabled' });
  return filepath;
}

export async function screenshotElement(
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

export async function waitForAppLoad(page: Page) {
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

// ── Supabase auth mock (bypasses onboarding) ───────────────────
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

export async function setupDemoMode(page: Page) {
  // Seed a valid Supabase session cookie BEFORE the app hydrates.
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

// ── Tab navigation ────────────────────────────────────────────
// route key → tab label. The app is a bottom-nav SPA (no URL routes),
// so "navigating to a route" means switching the active tab.
export const ROUTE_TABS: Record<string, string> = {
  portfolio: 'Portfolio',
  watchlist: 'Watchlist',
  invest: 'Invest',
  ai: 'AI',
  settings: 'Settings',
};

export async function clickTab(page: Page, label: string) {
  const nav = page.locator('nav.fixed.bottom-0');

  if (label === 'AI') {
    const aiButton = nav.locator('button.bg-cyan-500, button[class*="cyan"]').first();
    await aiButton.click();
  } else {
    await nav.getByRole('button', { name: label, exact: true }).click();
  }
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// ── Primitive screen actions ──────────────────────────────────
// The four action types supported by the screen-map. Any other type is
// flagged (not guessed) per the capture tool contract.
export interface ScreenAction {
  type: string;
  y?: number;
  selector?: string;
  text?: string;
  ms?: number;
}

export const SUPPORTED_ACTIONS = new Set(['scrollTo', 'tap', 'waitFor', 'sendMessage']);

export async function runAction(
  page: Page,
  action: ScreenAction
): Promise<{ ok: boolean; warning?: string }> {
  if (!action || typeof action !== 'object' || !SUPPORTED_ACTIONS.has(action.type)) {
    return {
      ok: false,
      warning: `No handler for action type "${action?.type ?? 'unknown'}" — skipped (not guessed)`,
    };
  }

  try {
    switch (action.type) {
      case 'scrollTo': {
        if (typeof action.y === 'number') {
          await page.evaluate((y) => window.scrollTo(0, y), action.y);
        } else if (action.selector) {
          await page.locator(action.selector).first().scrollIntoViewIfNeeded().catch(() => {});
        }
        break;
      }
      case 'tap': {
        const loc = action.selector
          ? page.locator(action.selector).first()
          : action.text
            ? page.locator(`text=${action.text}`).first()
            : null;
        if (!loc) return { ok: false, warning: 'tap action missing selector/text' };
        const count = await loc.count().catch(() => 0);
        if (count === 0) {
          return { ok: false, warning: `tap target not found: ${action.selector ?? action.text}` };
        }
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.tap({ timeout: 5000 }).catch(() => loc.click({ timeout: 5000 }));
        break;
      }
      case 'waitFor': {
        if (typeof action.ms === 'number') {
          await page.waitForTimeout(action.ms);
        } else if (action.selector) {
          await page
            .locator(action.selector)
            .first()
            .waitFor({ state: 'visible', timeout: 10000 })
            .catch(() => {});
        }
        break;
      }
      case 'sendMessage': {
        const ta = page.locator('.vantage-input-bar textarea').first();
        await ta.fill(action.text ?? '');
        await ta.press('Enter');
        break;
      }
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, warning: `Action "${action.type}" failed: ${err?.message ?? err}` };
  }
}

// Scroll through the page to trigger lazy-loading, then return to top so a
// full-page screenshot captures as much rendered content as possible.
export async function primeLazyContent(page: Page) {
  await page
    .evaluate(async () => {
      const h = Math.max(document.body.scrollHeight, 4000);
      for (let y = 0; y <= h; y += 400) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => {});
  await page.waitForTimeout(300);
}
