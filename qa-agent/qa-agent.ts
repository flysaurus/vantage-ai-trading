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

// ─── VISUAL QA CHECKS (Claude-only, no text assertions) ───
const VISUAL_CHECKS = [
  {
    screenshot: '03_position_card.png',
    checklist: [
      'A single stock position card is visible',
      'Card has a colored left border ' +
      '(green for gain, red for loss)',
      'TODAY and TOTAL appear as small ' +
      'gray uppercase labels',
      'Dollar amounts are colored ' +
      '(green or red, not white)',
      'Design looks professional and clean',
      'Text is readable at mobile size',
    ],
  },
  {
    screenshot: '06_sticky_footer.png',
    checklist: [
      'A horizontal bar with three columns visible',
      'Numbers are bright white and large',
      'Labels below numbers are smaller and dimmer',
      'Bar has a subtle border or shadow',
      'Overall design feels premium',
      'Sits clearly above navigation bar',
    ],
  },
  {
    screenshot: 'p2_01_greeting.png',
    checklist: [
      'Greeting bubble has distinct styling ' +
      'from regular chat bubbles',
      'Has a subtle cyan border or background',
      'Compass icon or Vantage AI label present',
      'Text is italic or styled differently',
      'Feels like an advisor speaking, ' +
      'not a system message',
    ],
  },
  {
    screenshot: 'p2_10_invest_strategies.png',
    checklist: [
      'Strategy grid visible with multiple buttons',
      'Build Basket is highlighted or distinct ' +
      'from unavailable strategies',
      'Unavailable strategies have a Soon badge',
      'Grid layout is clean and even',
      'Icons and labels are clear',
    ],
  },
  {
    screenshot: 'p2_11_basket_curated.png',
    checklist: [
      'Multiple basket cards visible',
      'Each card has an emoji, name, and description',
      'Performance badge visible top right of each card',
      'Ticker pills row visible on each card',
      'Risk warning in italic below tickers',
      'Preview and Invest buttons clearly visible',
      'Overall design is premium and trustworthy',
    ],
  },
];

async function runVisualQA(): Promise<string[]> {
  const findings: string[] = [];

  const checks = VISUAL_CHECKS;

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
  const statusEmoji = fails === 0 && testResults.failed === 0 ? '✅' : testResults.failed < 2 && fails < 3 ? '⚠️' : '❌';

  const report = [
    `${statusEmoji} *Vantage QA Report*`,
    `${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`,
    '',
    '*Functional Tests (Playwright):*',
    `${testResults.passed} passed · ${testResults.failed} failed`,
    '',
    '*Visual Tests (Claude):*',
    `${passes} pass · ${fails} fail · ${warnings} warnings`,
    '',
    fails === 0 && testResults.failed === 0
      ? '✅ All checks passed'
      : '🔧 Issues found — see details below',
    '',
    ...visualFindings.slice(0, 15),
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
