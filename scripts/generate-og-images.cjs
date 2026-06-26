// ─── Generate OG Images ─────────────────────────────────────
// Renders 5 OG card images (1200×630) using headless Chromium.
// Run: node scripts/generate-og-images.cjs

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ogDir = path.join(__dirname, '..', 'public', 'og');
fs.mkdirSync(ogDir, { recursive: true });

const STYLES = {
  buffett: {
    emoji: '🏛️',
    fullHeadline: 'The Patient Builder',
    tag: 'Buffett-style',
    description: "You play the long game. You'd rather own something great for ten years than chase something hot for ten days.",
  },
  lynch: {
    emoji: '🔍',
    fullHeadline: 'The Growth Spotter',
    tag: 'Lynch-style',
    description: "You catch things early. You're drawn to businesses that are quietly getting bigger before anyone else notices.",
  },
  livermore: {
    emoji: '📈',
    fullHeadline: 'The Momentum Reader',
    tag: 'Livermore-style',
    description: "You trust what's actually happening right now. Price and timing tell you more than a good story does.",
  },
  munger: {
    emoji: '🧠',
    fullHeadline: 'The Rational Thinker',
    tag: 'Munger-style',
    description: "You think before you act. Good business, good people, good incentives — if it doesn't add up, you walk away.",
  },
  soros: {
    emoji: '🌐',
    fullHeadline: 'The Contrarian',
    tag: 'Soros-style',
    description: "You look where others aren't looking. The crowd being wrong is often exactly where the opportunity is.",
  },
};

function buildHtml(style) {
  const s = STYLES[style];
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;width:1200px;height:630px;overflow:hidden;">
  <div style="
    width:1200px;height:630px;
    background:linear-gradient(135deg,#0a0f1e 0%,#111827 50%,#0f172a 100%);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:40px 60px;box-sizing:border-box;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    position:relative;">
    <!-- Subtle compass watermark -->
    <div style="position:absolute;top:30px;left:40px;opacity:0.3;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#22d3ee" stroke-width="1.5"/>
        <path d="M12 6v12M12 6l4 6-4 6M12 6l-4 6 4 6" stroke="#22d3ee" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <!-- Vantage wordmark top-right -->
    <div style="position:absolute;top:30px;right:40px;display:flex;align-items:center;gap:8px;">
      <span style="font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em;">Vantage</span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="#22d3ee" stroke-width="2"/>
        <path d="M12 6v12M12 6l4 6-4 6M12 6l-4 6 4 6" stroke="#22d3ee" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>

    <!-- Center content -->
    <div style="display:flex;flex-direction:column;align-items:center;gap:20px;z-index:1;">
      <!-- Emoji -->
      <span style="font-size:100px;line-height:1;filter:drop-shadow(0 8px 24px rgba(34,211,238,0.2));">${s.emoji}</span>
      <!-- Headline -->
      <span style="font-size:52px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;text-align:center;">${s.fullHeadline}</span>
      <!-- Tag pill -->
      <span style="
        display:inline-block;padding:8px 24px;border-radius:999px;
        border:1px solid rgba(34,211,238,0.4);background:rgba(34,211,238,0.1);
        font-size:18px;font-weight:600;color:#22d3ee;">${s.tag}</span>
      <!-- Description -->
      <p style="
        font-size:20px;color:rgba(255,255,255,0.75);text-align:center;
        max-width:700px;line-height:1.5;margin:0;">${s.description}</p>
    </div>

    <!-- Footer -->
    <div style="position:absolute;bottom:30px;left:0;right:0;text-align:center;">
      <span style="font-size:14px;color:#475569;font-weight:500;letter-spacing:0.04em;">Discover your style at vantage-ai-trading.vercel.app</span>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 } });
  const page = await context.newPage();

  for (const style of Object.keys(STYLES)) {
    console.log(`Generating /og/${style}.png...`);
    const html = buildHtml(style);
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300); // Let fonts/filters settle
    await page.screenshot({
      path: path.join(ogDir, `${style}.png`),
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    console.log(`  ✅ ${style}.png (${fs.statSync(path.join(ogDir, `${style}.png`)).size} bytes)`);
  }

  await browser.close();
  console.log('Done — all 5 OG images generated.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
