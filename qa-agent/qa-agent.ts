import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './screenshots';
const RESULTS_FILE = './results/results.json';

// ─── SEND TELEGRAM MESSAGE ───
async function sendTelegram(message: string): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
  };

  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── SEND TELEGRAM PHOTO ───
async function sendTelegramPhoto(
  imagePath: string,
  caption: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('chat_id', TELEGRAM_CHAT_ID);
  form.append('caption', caption);
  form.append('photo', fs.createReadStream(imagePath));

  await fetch(url, { method: 'POST', body: form as any });
}

// ─── CLAUDE VISUAL REVIEW ───
async function claudeReviewScreenshot(
  imagePath: string,
  checklistItems: string[]
): Promise<{ pass: string[]; fail: string[]; warnings: string[]; notes?: string }> {

  if (!fs.existsSync(imagePath)) {
    return { pass: [], fail: ['Screenshot not found'], warnings: [] };
  }

  const imageData = fs.readFileSync(imagePath).toString('base64');

  const checklist = checklistItems
    .map((item, i) => `${i + 1}. ${item}`)
    .join('\n');

  const response = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageData,
              },
            },
            {
              type: 'text',
              text: `You are a QA agent reviewing a FULL PAGE
screenshot of Vantage, a mobile portfolio app.

IMPORTANT CONTEXT:
- This is a FULL PAGE screenshot — scroll down
 mentally to see all sections
- The page has these sections TOP TO BOTTOM:
 1. Header (Vantage logo + market status)
 2. Market Overview (SPY/QQQ/DIA/IWM benchmarks)
 3. Account Value card (total portfolio value)
 4. Chart placeholder
 5. HOLDINGS section (individual stock cards)
 6. Bottom navigation

- When checking for "position cards" or "holdings",
 look in section 5 — NOT section 2
- SPY and QQQ appearing in section 2 are market
 benchmarks, NOT portfolio holdings
- Portfolio holdings will show GOOGL, MSFT, JPM,
 ADBE, ISRG, COST, LLY, NVDA plus possibly SPY/QQQ

Review this screenshot against this checklist:
${checklist}

Respond ONLY with valid JSON, no markdown:
{
 "pass": ["item text for passing items"],
 "fail": ["item text for failing items"],
 "warnings": ["item text for uncertain items"],
 "notes": "observations"
}`,
            },
          ],
        }],
      }),
    }
  );

  const data = await response.json() as any;
  const text = data.content?.[0]?.text || '{}';

  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    // Safety: ensure required arrays exist
    if (!Array.isArray(parsed.pass)) parsed.pass = [];
    if (!Array.isArray(parsed.fail)) parsed.fail = [];
    if (!Array.isArray(parsed.warnings)) parsed.warnings = [];
    return parsed;
  } catch {
    return { pass: [], fail: [text], warnings: [] };
  }
}

// ─── RUN PLAYWRIGHT TESTS ───
function runTests(): {
  passed: number;
  failed: number;
  output: string;
} {
  try {
    const output = execSync(
      'npx playwright test --reporter=json',
      {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 300000,
      }
    );

    // Parse results
    if (fs.existsSync(RESULTS_FILE)) {
      const results = JSON.parse(
        fs.readFileSync(RESULTS_FILE, 'utf8')
      );
      return {
        passed: results.stats?.expected || 0,
        failed: results.stats?.unexpected || 0,
        output,
      };
    }
    return { passed: 0, failed: 0, output };
  } catch (e: any) {
    return {
      passed: 0,
      failed: 1,
      output: e.stdout || e.message,
    };
  }
}

// ─── VISUAL QA CHECKS ───
async function runVisualQA(): Promise<string[]> {
  const findings: string[] = [];

  const checks = [
    {
      screenshot: '03_holdings_section.png',
      checklist: [
        'Holdings section header visible',
        'Multiple position cards showing below header',
        'Ticker symbols visible: GOOGL, MSFT, ' +
        'JPM, NVDA, ADBE, ISRG, COST, LLY, SPY, QQQ',
        'Each card shows a dollar amount',
        'Green text for gains, red text for losses',
        'TODAY and TOTAL labels on each card',
        'Share counts visible (e.g. 25 shares, 80 shares)',
      ],
    },
    {
      screenshot: '03_position_card.png',
      checklist: [
        'Individual position card clearly visible',
        'Ticker symbol bold and prominent',
        'Market value in dollars showing',
        'TODAY P&L with color (green or red)',
        'TOTAL P&L with color (green or red)',
        'Share count visible',
        'ETF badge if applicable',
      ],
    },
    {
      screenshot: '06_sticky_footer.png',
      checklist: [
        'Three-column summary bar visible',
        'Market Value column showing dollar amount',
        'Today column showing P&L with percentage',
        'Total column showing P&L with percentage',
        'Text is bright and readable',
        'Bar sits above navigation',
      ],
    },
    {
      screenshot: '03c_baskets_section.png',
      checklist: [
        'BASKETS section header visible',
        'Basket cards or basket names visible',
        'Each basket shows emoji and theme',
        'Basket performance metrics shown (if data available)',
      ],
    },
    {
      screenshot: '07_ai_tab_load.png',
      checklist: [
        'AI tab header ("Ask Vantage AI" or similar) is visible',
        'History button is visible',
        'Daily Brief card area is shown',
        'No broken layout or overlapping elements',
      ],
    },
    {
      screenshot: '10_ai_quick_actions.png',
      checklist: [
        'Strategy Ideas button is visible',
        'Market Pulse button is visible',
        'Tax Check button is visible',
        'Alerts button is visible',
        'Buttons are in a 2x2 grid layout',
        'Buttons are not hidden behind the bottom nav',
      ],
    },
    {
      screenshot: '12_invest_order_history.png',
      checklist: [
        'Order history list is visible',
        'Orders show ticker symbols',
        'Each order shows status (FILLED etc)',
        'Order cards show BUY type and share count',
      ],
    },
    {
      screenshot: '06_portfolio_buying_power.png',
      checklist: [
        'An ACCOUNT VALUE section shows a large ' +
        'dollar amount (total portfolio value)',
        'A BUYING POWER label and dollar amount visible',
        'A CASH label and dollar amount visible',
        'BUYING POWER and CASH show the same value',
        'Both values are greater than $0',
        'TODAY label (for daily P&amp;L) appears in gray text',
        'TOTAL label (for all-time P&amp;L) appears in gray text',
        'The P&amp;L dollar amounts next to TODAY/TOTAL ' +
        'are colored red or green (not gray)',
        'Demo Mode badge visible near account value',
      ],
    },
  ];

  for (const check of checks) {
    const imagePath = path.join(SCREENSHOTS_DIR, check.screenshot);

    if (!fs.existsSync(imagePath)) {
      findings.push(`⚠️ Screenshot missing: ${check.screenshot}`);
      continue;
    }

    const result = await claudeReviewScreenshot(
      imagePath,
      check.checklist
    );

    for (const item of result.pass) {
      findings.push(`✅ ${item}`);
    }
    for (const item of result.fail) {
      findings.push(`❌ ${item}`);
    }
    for (const item of result.warnings) {
      findings.push(`⚠️ ${item}`);
    }
    if (result.notes) {
      findings.push(`📝 ${result.notes}`);
    }
  }

  return findings;
}

// ─── MAIN ───
const LOCK_FILE = '/tmp/vantage-qa.lock';
const LAST_RUN_FILE = '/tmp/vantage-qa-lastrun';
const MIN_INTERVAL_MS = 3 * 60 * 1000; // 3 min minimum between runs

function acquireLock(): boolean {
  // Rate limit check
  if (fs.existsSync(LAST_RUN_FILE)) {
    const lastRun = parseInt(fs.readFileSync(LAST_RUN_FILE, 'utf8'));
    const elapsed = Date.now() - lastRun;
    if (elapsed < MIN_INTERVAL_MS) {
      const wait = Math.ceil((MIN_INTERVAL_MS - elapsed) / 1000);
      console.log(`Too soon. Wait ${wait}s before next run.`);
      return false;
    }
  }

  // Stale lock check
  if (fs.existsSync(LOCK_FILE)) {
    const lockAge = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
    if (lockAge > 10 * 60 * 1000) {
      fs.unlinkSync(LOCK_FILE);
      console.log('Removed stale lock file');
    } else {
      console.log('QA already running, exiting');
      return false;
    }
  }

  fs.writeFileSync(LOCK_FILE, String(Date.now()));
  fs.writeFileSync(LAST_RUN_FILE, String(Date.now()));
  return true;
}

function releaseLock(): void {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
  }
}

async function main() {
  if (!acquireLock()) {
    console.log('Another QA instance running. Exiting.');
    process.exit(0);
  }

  try {
  console.log('🔍 Starting QA Agent...');

  await sendTelegram(
    '🔍 *QA Agent Started*\n' +
    'Running Playwright tests + visual review...'
  );

  // Ensure results dir exists
  fs.mkdirSync('./results', { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // Run automated tests
  console.log('Running Playwright tests...');
  const testResults = runTests();

  // Run visual QA
  console.log('Running visual QA...');
  const visualFindings = await runVisualQA();

  // Count results
  const passes = visualFindings.filter(f => f.startsWith('✅')).length;
  const fails = visualFindings.filter(f => f.startsWith('❌')).length;
  const warnings = visualFindings.filter(f => f.startsWith('⚠️')).length;

  // Build report
  const statusEmoji = fails === 0 ? '✅' : fails < 3 ? '⚠️' : '❌';

  const report = [
    `${statusEmoji} *Vantage QA Report*`,
    `${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`,
    '',
    `*Automated Tests:* ${testResults.passed} passed, ${testResults.failed} failed`,
    `*Visual QA:* ${passes} pass, ${fails} fail, ${warnings} warnings`,
    '',
    '*Findings:*',
    ...visualFindings.slice(0, 20), // Telegram limit
    '',
    fails === 0
      ? '🚀 All checks passed — safe to proceed!'
      : `🔧 ${fails} issue(s) need fixing before next phase`,
  ].join('\n');

  await sendTelegram(report);

  // Send key failure screenshots
  if (fails > 0) {
    const failScreenshots = [
      '03_portfolio_holdings.png',
      '12_invest_order_history.png',
    ];

    for (const ss of failScreenshots) {
      const p = path.join(SCREENSHOTS_DIR, ss);
      if (fs.existsSync(p)) {
        await sendTelegramPhoto(p, `Screenshot: ${ss}`);
      }
    }
  }

  console.log('QA complete. Report sent to Telegram.');
  process.exit(fails > 0 ? 1 : 0);
  } finally {
    releaseLock();
  }
}

main().catch(async (e) => {
  releaseLock();
  console.error('QA Agent error:', e);
  await sendTelegram(`❌ *QA Agent Error*\n${e.message}`);
  process.exit(1);
});
