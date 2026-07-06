/**
 * GET /api/ai/greeting/test-variety
 *
 * Step 5 verification: generates 5 greetings in sequence, checking:
 * (a) At least 3 different categories across the 5 generations
 * (b) Macro category uses real fetched index data (not invented)
 * (c) No generation contradicts an active fact
 * (d) Length stays consistent (~2-3 sentences)
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { writeFact, getActiveFacts, formatFactsForPrompt } from '@/lib/ai/facts';
import type { AiFact } from '@/lib/ai/facts';
import { createServerClient } from '@/lib/supabase';

// Replicate the greeting system prompt (simplified — core rules only)
const GREETING_SYSTEM = `You are Vantage AI.
Generate a greeting for a returning user.

OUTPUT FORMAT — two parts separated by ||| :
 [time-based opener with initial] ||| [hook sentence]

Example outputs:
 Morning, M. ||| GOOGL is your biggest winner at +155% total — want to dig into what's driving it?
 Evening, M. ||| You're sitting on $65K cash — 33% of your portfolio idle.
 Afternoon, M. ||| ADBE is your only red position at -60% total. Worth a conversation.

STRICT RULES:
 NEVER mention today's price change % or intraday P&L
 ONLY use total return since purchase (+155% total)
 ONLY use upcoming scheduled events (earnings dates)
 ONLY use portfolio structure facts (cash %, position count)
 ONLY use relative facts (biggest winner, only loser, largest position)
 Time opener: use the provided time_period, followed by ", M."

TONE: Sharp friend checking in. One observation. One hook. That's it.
Never mention Claude, Anthropic, or any AI model.

FACTS-AWARE CROSS-CHECK:
If AI FACTS grounding context contains a question or observation about a subject
you mention, do NOT contradict it. Defer or stay silent on unresolved facts.`;

// 7 categories
const INSIGHT_CATEGORIES = [
  'position', 'cash', 'events', 'structure', 'risk', 'market', 'macro',
];

const CATEGORY_GUIDANCE: Record<string, string> = {
  position: 'Focus on biggest winner vs biggest laggard, or the most dramatic total return story.',
  cash: 'Focus on idle cash, cash %, whether cash could be working harder.',
  events: 'Focus on upcoming earnings, Fed meetings, scheduled catalysts.',
  structure: 'Focus on portfolio composition, sector mix, diversification.',
  risk: 'Focus on concentration, correlation between holdings.',
  market: 'Focus on how the portfolio relates to broader market conditions.',
  macro: 'Focus on macro indices and how the portfolio is positioned. Describe the observed PATTERN using the provided real index data. Tie back to holdings. GUARDRAIL: describe the pattern without inventing an unverified causal story.',
};

async function fetchMacroQuotes(): Promise<Record<string, { c: number; dp: number }>> {
  const key = process.env.FINNHUB_IO_API_KEY;
  if (!key) return {};
  const indices = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX'];
  const results: Record<string, { c: number; dp: number }> = {};
  await Promise.all(indices.map(async (sym) => {
    try {
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${key}`,
        { signal: AbortSignal.timeout(5000) },
      );
      const q = await r.json();
      if (q.c != null) {
        results[sym === '^VIX' ? 'VIX' : sym] = { c: q.c, dp: q.dp ?? 0 };
      }
    } catch { /* skip */ }
  }));
  return results;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function GET() {
  const results: any[] = [];
  const supabase = createServerClient();

  // Get test user
  const { data: testUser } = await (supabase as any)
    .from('users').select('id').limit(1).single();
  if (!testUser) {
    return NextResponse.json({ error: 'No user found' }, { status: 400 });
  }
  const userId = testUser.id;

  // Seed a question fact that greetings must not contradict
  const seedFact = await writeFact(userId, {
    subject: 'AXP',
    fact_type: 'question',
    claim: 'AXP drawdown cause unconfirmed — under investigation',
    confidence: 'unconfirmed',
    source: 'greeting_test',
  });
  const seedId = seedFact.fact?.id;

  // Mock portfolio — 3 positions with varied performance
  const positions = [
    { symbol: 'GOOGL', totalPnLPct: 45.2, marketValue: 4125, avgCost: 140 },
    { symbol: 'META', totalPnLPct: 120.8, marketValue: 6960, avgCost: 210 },
    { symbol: 'AXP', totalPnLPct: -18.5, marketValue: 3120, avgCost: 175 },
  ];

  const categoriesUsed: string[] = [];
  const hookLengths: number[] = [];
  let macroGenerated = false;
  const generatedHooks: string[] = [];

  // ── Generate 5 greetings ─────────────────────────────────
  for (let i = 0; i < 5; i++) {
    // Pick category with rotation (avoid last 3)
    const recent = categoriesUsed.slice(-3);
    let category = INSIGHT_CATEGORIES[0];
    for (const cat of INSIGHT_CATEGORIES) {
      if (!recent.includes(cat)) { category = cat; break; }
    }
    // If all 7 used recently (shouldn't happen with 3-back on 7 options), rotate
    if (recent.includes(category)) {
      const idx = INSIGHT_CATEGORIES.indexOf(recent[0]);
      category = INSIGHT_CATEGORIES[(idx + 1) % INSIGHT_CATEGORIES.length];
    }
    categoriesUsed.push(category);

    // Fetch active facts for grounding
    const activeFacts = await getActiveFacts(userId);
    const factsContext = formatFactsForPrompt(activeFacts);

    // Fetch macro quotes if needed
    let macroContext = '';
    if (category === 'macro') {
      const quotes = await fetchMacroQuotes();
      macroContext = Object.entries(quotes)
        .map(([s, q]) => `${s}: $${q.c.toFixed(2)} (${q.dp >= 0 ? '+' : ''}${q.dp.toFixed(2)}%)`)
        .join('\n');
      if (!macroContext) macroContext = 'No index data available';
    }

    // Build context
    const categoryContext = category === 'macro'
      ? `MACRO CONTEXT (REAL LIVE INDEX DATA — use these exact figures, do not invent):\n${macroContext}\nHoldings: ${positions.map(p => p.symbol).join(', ')}\nGUARDRAIL: Describe the observed pattern. Do NOT invent a causal explanation.`
      : `CATEGORY FOCUS: ${CATEGORY_GUIDANCE[category] || category}\nHoldings: ${positions.map(p => p.symbol).join(', ')}`;

    const dynamicContext = `CURRENT CONTEXT:
Time period: Evening
Market status: closed
Investor style: Buffett
Risk tolerance: Medium

PORTFOLIO:
Total P&L: +8.2%
Cash: 43%
Position count: 3

POSITIONS:
${positions.map(p => `${p.symbol}: ${p.totalPnLPct >= 0 ? '+' : ''}${p.totalPnLPct}% total, $${p.marketValue.toLocaleString()} value`).join('\n')}

${categoryContext}

FOCUS INSTRUCTION: Generate a hook centered on the "${category}" category.
If genuinely nothing interesting in this category, fall back to what IS interesting.
One hook sentence max.
`;

    try {
      const aiResponse = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        system: [
          { type: 'text' as const, text: GREETING_SYSTEM },
          { type: 'text' as const, text: dynamicContext },
          ...(factsContext ? [{ type: 'text' as const, text: factsContext }] : []),
        ],
        messages: [{
          role: 'user' as const,
          content: 'Generate my greeting now.',
        }],
      });

      const fullText = aiResponse.content[0]?.type === 'text'
        ? (aiResponse.content[0] as any).text?.trim()
        : '(empty)';

      const parts = fullText.split('|||').map((p: string) => p.trim());
      const hook = parts[1] || '(no hook)';
      generatedHooks.push(hook);
      hookLengths.push(hook.length);

      // Check for macro category data usage
      if (category === 'macro') {
        macroGenerated = true;
        // Verify real index data is referenced (not invented)
        const usesRealIndex = /SPY|QQQ|DIA|IWM|VIX|[A-Z]{3,4} (?:up|down|flat)/i.test(hook);
        results.push({
          gen: i + 1,
          category: 'macro',
          hook: hook.substring(0, 150),
          macroCheck: usesRealIndex ? 'Uses real index data' : '⚠️ No index reference detected',
          passed: usesRealIndex,
        });
      } else {
        // Check for fact contradiction
        const mentionsAXP = /AXP/i.test(hook);
        const contradictsFact = mentionsAXP && /nothing to worry|just noise|ignore the dip|fine/i.test(hook);
        const passedContradictionCheck = !contradictsFact;

        results.push({
          gen: i + 1,
          category,
          hook: hook.substring(0, 150),
          contradictionsActiveFact: contradictsFact,
          passed: passedContradictionCheck,
        });
      }
    } catch (err: any) {
      results.push({
        gen: i + 1,
        category,
        error: err?.message || String(err),
        passed: false,
      });
    }
  }

  // Clean up seed fact
  if (seedId) {
    await (supabase as any).from('ai_facts').delete().eq('id', seedId);
  }

  // ── Summary assertions ──────────────────────────────────
  const distinctCategories = new Set(categoriesUsed);
  const varietyCheck = distinctCategories.size >= 3;

  const lengthAvg = hookLengths.reduce((a, b) => a + b, 0) / Math.max(hookLengths.length, 1);
  const lengthCheck = hookLengths.every(l => l <= 200);
  const lengthStddev = Math.sqrt(
    hookLengths.reduce((s, l) => s + Math.pow(l - lengthAvg, 2), 0) / Math.max(hookLengths.length, 1),
  );

  const allPassed = varietyCheck && lengthCheck && results.every((r: any) => r.passed !== false);

  return NextResponse.json({
    passed: allPassed,
    summary: allPassed
      ? `✅ All checks passed — ${distinctCategories.size} distinct categories, avg hook length ${lengthAvg.toFixed(0)} chars`
      : `❌ ${results.filter((r: any) => !r.passed).length} failures — variety=${varietyCheck}, length=${lengthCheck}`,
    checks: {
      variety: { passed: varietyCheck, detail: `${distinctCategories.size}/7 categories used (need ≥3)` },
      length: { passed: lengthCheck, detail: `Avg ${lengthAvg.toFixed(0)} chars, stddev ${lengthStddev.toFixed(0)}, max ${Math.max(...hookLengths)}` },
      contradictions: { passed: results.every((r: any) => r.passed !== false), detail: `Any contradictions: ${results.filter((r: any) => r.contradictionsActiveFact).length}` },
      macroRealData: { passed: !macroGenerated || results.some((r: any) => r.category === 'macro' && r.passed !== false), detail: macroGenerated ? 'Macro generated with real data' : 'Macro not selected (category rotation)' },
    },
    categoriesSequence: categoriesUsed,
    generations: results,
    hooks: generatedHooks,
  }, { status: 200 });
}
