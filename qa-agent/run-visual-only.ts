import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || './screenshots';

async function claudeReviewScreenshot(imagePath: string, checklistItems: string[]): Promise<any> {
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
          { type: 'text', text: `Review this mobile app screenshot (Vantage AI trading app) against:
${checklist}

Respond ONLY valid JSON: {"pass": [...], "fail": [...], "warnings": [...], "notes": "..."}` },
        ],
      }],
    }),
  });
  
  const data = await response.json() as any;
  const text = data.content?.[0]?.text || '{}';
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { pass: [], fail: [text], warnings: [] };
  }
}

async function main() {
  const checks = [
    {
      file: '03_portfolio_holdings.png',
      items: ['Portfolio page shows holding cards below the market overview','Multiple position cards visible with dollar amounts','Green values show positive G/L, red shows negative G/L','No error messages or broken UI visible'],
    },
    {
      file: '07_ai_tab_load.png',
      items: ['AI tab header ("Ask Vantage AI" or similar) visible','History button visible','Daily Brief card area shown','No broken layout or overlapping'],
    },
    {
      file: '10_ai_quick_actions.png',
      items: ['Build Basket button visible','Market Pulse button visible','Tax Check button visible','Alerts button visible','Buttons in 2x2 grid','Buttons not hidden behind bottom nav'],
    },
    {
      file: '12_invest_order_history.png',
      items: ['Order history list visible','Orders show ticker symbols','Each order shows status (FILLED etc)','Order cards show BUY type and share count'],
    },
    {
      file: '06_portfolio_buying_power.png',
      items: ['Account value displayed','Buying Power displayed','TODAY and TOTAL P&L labels are gray','P&L dollar amounts colored red or green','Dashboard layout clean'],
    },
  ];

  let totalPass = 0, totalFail = 0, totalWarn = 0;
  
  for (const c of checks) {
    const fp = path.join(SCREENSHOTS_DIR, c.file);
    console.log(`\n📸 Reviewing ${c.file}...`);
    
    if (!fs.existsSync(fp)) {
      console.log(`  ⚠️ Missing`);
      continue;
    }
    
    const r = await claudeReviewScreenshot(fp, c.items);
    console.log(`  ✅ ${r.pass.length} pass, ❌ ${r.fail.length} fail, ⚠️ ${r.warnings.length} warnings`);
    for (const p of r.pass) console.log(`    ✅ ${p}`);
    for (const f of r.fail) console.log(`    ❌ ${f}`);
    for (const w of r.warnings) console.log(`    ⚠️ ${w}`);
    if (r.notes) console.log(`    📝 ${r.notes}`);
    
    totalPass += r.pass.length;
    totalFail += r.fail.length;
    totalWarn += r.warnings.length;
  }
  
  console.log(`\n━━━ SUMMARY ━━━`);
  console.log(`✅ ${totalPass} pass  ❌ ${totalFail} fail  ⚠️ ${totalWarn} warnings`);
}

main().catch(e => { console.error(e); process.exit(1); });
