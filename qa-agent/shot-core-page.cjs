// Shot the public /core preview route (desktop + mobile), verify the WebGL core mounts.
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.APP_BASE || 'http://127.0.0.1:3002';
const OUT = '/root/.openclaw/workspace/tmp-shots';

const KILL = `(() => { document.querySelectorAll('nextjs-portal').forEach(n => { try { if (n.shadowRoot) n.shadowRoot.innerHTML=''; } catch(e){} n.remove(); }); })()`;

const VIEWS = [
  { name: 'desktop', width: 1440, height: 900, dsf: 1 },
  { name: 'mobile', width: 430, height: 932, dsf: 2 },
];

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const errs = [];
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.dsf });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`${v.name} pageerror: ${e.message.slice(0, 140)}`));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(`${v.name} console: ${m.text().slice(0, 140)}`); });
    await page.goto(`${BASE}/core`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => !!window.__coreStats, null, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const stats = await page.evaluate(() => window.__coreStats || null);
    const statsText = await page.locator('[data-testid="core-stats"]').innerText().catch(() => '(none)');
    const btnCount = await page.locator('[data-state]').count();
    await page.evaluate(KILL).catch(() => {});
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `core-page-${v.name}.png`) });
    console.log(`${v.name}: stats=${JSON.stringify(stats)} | ui="${statsText}" | state-buttons=${btnCount}`);
    // exercise the thinking button + light surface, then shoot again (mobile only)
    if (v.name === 'mobile') {
      await page.locator('[data-state="thinking"]').click();
      await page.waitForTimeout(4500);
      await page.evaluate(KILL).catch(() => {});
      await page.screenshot({ path: path.join(OUT, 'core-page-mobile-thinking.png') });
      console.log('mobile/thinking captured');
    }
    await ctx.close();
  }
  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 6).join('\n') : 'no page errors');
  await browser.close();
})().catch((e) => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
