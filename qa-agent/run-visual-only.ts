import * as dotenv from 'dotenv';
dotenv.config();
import * as fs from 'fs';
import * as path from 'path';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './screenshots';

async function claudeReviewScreenshot(imagePath: string, checklistItems: string[]): Promise<{ pass: string[]; fail: string[]; warnings: string[]; notes?: string }> {
  if (!fs.existsSync(imagePath)) {
    return { pass: [], fail: ['Screenshot not found'], warnings: [] };
  }
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const checklist = checklistItems.map((item, i) => `${i + 1}. ${item}`).join('\n');
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          { type: 'text', text: `You are a QA agent reviewing screenshots of Vantage, a mobile portfolio app.

Review this screenshot against this checklist:
${checklist}

Respond ONLY with valid JSON, no markdown:
{ "pass": ["item text for passing items"], "fail": ["item text for failing items"], "warnings": ["item text for uncertain items"], "notes": "observations" }` }
        ]
      }]
    }),
  });
  const data = await response.json() as any;
  const text = data.content?.[0]?.text || '{}';
  try {
    const cleaned = text.replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.pass)) parsed.pass = [];
    if (!Array.isArray(parsed.fail)) parsed.fail = [];
    if (!Array.isArray(parsed.warnings)) parsed.warnings = [];
    return parsed;
  } catch {
    return { pass: [], fail: [text], warnings: [] };
  }
}

async function main() {
  console.log('🔍 Running Visual QA only...\n');
  
  const checks = [
    {
      file: '03_holdings_section.png',
      label: 'HOLDINGS SECTION',
      checklist: [
        'Holdings section header visible',
        'Multiple position cards showing below header',
        'Ticker symbols visible: GOOGL, MSFT, JPM, NVDA, ADBE, ISRG, COST, LLY, SPY, QQQ',
        'Each card shows a dollar amount',
        'Green text for gains, red text for losses',
        'TODAY and TOTAL labels on each card',
        'Share counts visible (e.g. 25 shares, 80 shares)',
      ],
    },
    {
      file: '03_position_card.png',
      label: 'INDIVIDUAL POSITION CARD',
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
      file: '06_sticky_footer.png',
      label: 'STICKY FOOTER',
      checklist: [
        'Three-column summary bar visible',
        'Market Value column showing dollar amount',
        'Today column showing P&L with percentage',
        'Total column showing P&L with percentage',
        'Text is bright and readable',
        'Bar sits above navigation',
      ],
    },
  ];

  for (const check of checks) {
    const imgPath = path.join(SCREENSHOTS_DIR, check.file);
    const size = fs.existsSync(imgPath) ? `${(fs.statSync(imgPath).size / 1024).toFixed(1)}KB` : 'MISSING';
    console.log(`─── ${check.label} (${check.file}) [${size}] ───`);
    
    const result = await claudeReviewScreenshot(imgPath, check.checklist);
    
    for (const item of result.pass) console.log(`  ✅ ${item}`);
    for (const item of result.fail) console.log(`  ❌ ${item}`);
    for (const item of result.warnings) console.log(`  ⚠️ ${item}`);
    if (result.notes) console.log(`  📝 ${result.notes}`);
    console.log('');
  }
  
  console.log('Visual QA complete.');
}

main().catch(console.error);
