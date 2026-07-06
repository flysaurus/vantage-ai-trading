/**
 * GET /api/ai/weekly-snapshot/test-contradiction
 *
 * Step 5 verification: reproduces the original bug scenario.
 *
 * Test flow:
 * 1. Seed question fact: "AXP drawdown cause unconfirmed"
 * 2. Seed concentration observation: "financials 59%"
 * 3. Build the same grounding prompt the snapshot route uses
 *    (facts formatted via formatFactsForPrompt + the static system prompt)
 * 4. Call the AI directly with the grounding context
 * 5. Assert: Opportunities doesn't contradict the open question
 * 6. Assert: Any AXP recommendation acknowledges concentration
 * 7. Assert: Facts were written back post-generation
 * 8. Clean up seed facts
 */

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { writeFact, getActiveFacts, formatFactsForPrompt } from '@/lib/ai/facts';
import type { AiFact } from '@/lib/ai/facts';
import { callChatAI } from '@/lib/ai-provider';

// Same static system prompt used by the snapshot route
const SNAPSHOT_STATIC = {
  type: 'text' as const,
  text: `You are Vantage AI portfolio health analyst.
Generate a Weekly Portfolio Snapshot framed for the user's specific
investor style and risk tolerance (provided in the message).

VOICE: Write this like a sharp analyst texting their notes to a friend, not a Bloomberg terminal report.
Use real numbers. Call out what's actually wrong.

FORMAT RULES:
- Use bullet points starting with -. No long paragraphs.
- Keep each bullet focused — one clear point per bullet.
- No generic fluff. Every bullet must name a specific ticker, dollar amount, or percentage.

CRITICAL — FACTS-AWARE CROSS-CHECK:
Before finalizing Opportunities and Risks, check the "AI FACTS" grounding context:
1. If a [question] fact exists (e.g. "AXP drawdown cause unconfirmed"), any recommendation
   on that subject MUST defer — do NOT assert a confident conclusion contradicting it.
2. If a [observation] fact exists about concentration (e.g. "financials 59%"),
   any recommendation that increases that concentration MUST explicitly acknowledge the tradeoff.
3. Opportunities and Risks must be internally consistent.
4. Facts marked [unconfirmed] must NOT be treated as definitive.

Health scores must reflect reality: if a position is down >60%, the score cannot be above 6/10.

Structure your analysis as:

## OVERALL HEALTH (score X/10):

## OVERALL RISK: [LOW|MEDIUM|HIGH]

## RISKS (list 2-3):
Format each risk exactly like this:
- **Risk:** [what is happening]
- **Affects:** [which ticker(s)]
- **Watch:** [what to monitor]

## OPPORTUNITIES (list 2-3):
Format each opportunity exactly like this:
- **What:** [opportunity description]
- **Why:** [why it fits]
- **Consider at:** [price level — use suggestive "worth considering" not imperative "buy"]

## SUMMARY:
Lead with dollar amounts. Be concrete and specific.`,
  cache_control: { type: 'ephemeral' as const },
};

export async function GET() {
  const results: Array<{ assertion: string; passed: boolean; detail: string }> = [];
  const supabase = createServerClient();

  // Get test user
  const { data: testUser } = await (supabase as any)
    .from('users')
    .select('id')
    .limit(1)
    .single();

  if (!testUser) {
    return NextResponse.json({ error: 'No user found' }, { status: 400 });
  }

  const userId = testUser.id;
  const seedIds: string[] = [];

  try {
    // ── 1. Seed question fact ────────────────────────────────
    const qFact = await writeFact(userId, {
      subject: 'AXP',
      fact_type: 'question',
      claim: 'AXP drawdown cause unconfirmed — macro concerns vs earnings miss',
      confidence: 'unconfirmed',
      source: 'weekly_snapshot',
    });
    if (qFact.fact) seedIds.push(qFact.fact.id);
    results.push({
      assertion: '1. Question fact seeded',
      passed: !!qFact.fact,
      detail: qFact.fact ? `Created ${qFact.fact.id}` : 'Failed',
    });

    // ── 2. Seed concentration observation ─────────────────────
    const obsFact = await writeFact(userId, {
      subject: 'portfolio_concentration_financials',
      fact_type: 'observation',
      claim: 'Financials concentration at 59% of portfolio — flagged as watch item',
      confidence: 'confirmed',
      source: 'weekly_snapshot',
    });
    if (obsFact.fact) seedIds.push(obsFact.fact.id);
    results.push({
      assertion: '2. Concentration observation seeded',
      passed: !!obsFact.fact,
      detail: obsFact.fact ? `Created ${obsFact.fact.id}` : 'Failed',
    });

    // ── 3. Verify facts are active ───────────────────────────
    const activeFacts = await getActiveFacts(supabase);
    results.push({
      assertion: '3. Active facts present before generation',
      passed: activeFacts.length >= 2,
      detail: `${activeFacts.length} active facts found (expected >= 2)`,
    });

    // ── 4. Fetch portfolio state & build prompt context ──────
    const { data: portfolioState } = await (supabase as any)
      .from('demo_portfolio_state')
      .select('positions, cash_balance')
      .eq('user_id', userId)
      .maybeSingle();

    const positions: any[] = portfolioState?.positions || [];
    if (positions.length === 0) {
      // Even without positions, we can still test the facts-injection pipeline
      results.push({
        assertion: '4. Portfolio state loaded',
        passed: false,
        detail: 'No positions — skipping AI generation. Facts injection is wired correctly.',
      });
    } else {
      results.push({
        assertion: '4. Portfolio state loaded',
        passed: true,
        detail: `${positions.length} positions found`,
      });

      // Build a minimal portfolio data block
      const symbols = positions.map((p: any) => p.symbol);
      const positionLines = positions.map((p: any) => {
        const avgCost = p.avgCost || '?';
        const shares = p.qty || 0;
        return `  ${p.symbol}: ${shares} shares @ $${avgCost}`;
      });
      const dataBlock = [
        `WEEKLY PORTFOLIO HEALTH CHECK`,
        `Symbols: ${symbols.join(', ')}`,
        `Style: buffett | Risk: medium`,
        `Total positions: ${positions.length}`,
        '',
        'PORTFOLIO:',
        ...positionLines,
      ].join('\n');

      // Format facts as grounding context — same as the snapshot route
      const factsContext = formatFactsForPrompt(activeFacts);
      const fullUserContent = factsContext
        ? `${dataBlock}\n\n${factsContext}`
        : dataBlock;

      results.push({
        assertion: '5. Grounding context built',
        passed: fullUserContent.includes('AI FACTS'),
        detail: factsContext.length > 0
          ? `${factsContext.length} chars of facts context injected`
          : 'No facts context (may indicate missing facts)',
      });

      // ── 6. Call AI with facts grounding ───────────────────
      try {
        const aiResponse = await callChatAI({
          model: 'claude-haiku-4-5',
          messages: [{ role: 'user', content: fullUserContent }],
          systemBlocks: [SNAPSHOT_STATIC],
          maxTokens: 2000,
          temperature: 0.2,
        });
        const content = aiResponse.content.trim();

        // Extract opportunities section
        const oppMatch = content.match(
          /## OPPORTUNITIES?\s*\n?([\s\S]*?)(?=##\s*(?:SUMMARY|RISK))/i,
        );
        const oppText = oppMatch ? (oppMatch[1] || '') : '';

        // Assertion 6a: No contradiction with open AXP question
        const mentionsAXP = oppText.toUpperCase().includes('AXP');
        const assertsNoise = /macro noise|just noise|confirmed to be\b|buy now|buy the dip|gift/i.test(oppText);
        const defersToQuestion = /unconfirmed|cause.*unclear|investigate|see risk|pending/i.test(oppText);

        const aPassed = !(mentionsAXP && assertsNoise && !defersToQuestion);
        results.push({
          assertion: '6a. Opportunities does NOT contradict open AXP question',
          passed: aPassed,
          detail: aPassed
            ? `AXP mentioned=${mentionsAXP}, noise=${assertsNoise}, defers=${defersToQuestion}`
            : `FAILED: AXP confidently called "noise" despite open question`,
        });

        // Assertion 6b: Any AXP recommendation acknowledges concentration
        const recommendsAXPAdd = /(?:add|buy|increase|consider).*AXP.*(?:position|shares)/i.test(oppText);
        const acknowledgesConcentration = /concentrat|tradeoff|exposure|overweight|59%|financials.*weight/i.test(oppText);

        const bPassed = !recommendsAXPAdd || acknowledgesConcentration;
        results.push({
          assertion: '6b. AXP recommendation acknowledges concentration',
          passed: bPassed,
          detail: bPassed
            ? (recommendsAXPAdd ? 'Recommends + acknowledges' : 'No AXP add recommended')
            : 'FAILED: AXP add recommended without concentration acknowledgment',
        });

        // Assertion 6c: Write results back as facts
        let writtenCount = 0;
        // Parse risks into facts
        const riskMatch = content.match(
          /## RISKS?\s*\n?([\s\S]*?)(?=##\s*(?:SUMMARY|OPPORTUNITIES?))/i,
        );
        const riskText = riskMatch ? (riskMatch[1] || '') : '';
        const riskBlocks = riskText.split(/\n(?=\s*(?:[-•*]\s|\d+\.\s))/).filter(Boolean);
        const writtenRiskIds: string[] = [];

        for (const block of riskBlocks) {
          const riskLine = block.match(/\*\*Risk:\*\*\s*(.+?)(?:\n|$)/i);
          const affectsLine = block.match(/\*\*Affects:\*\*\s*(.+?)(?:\n|$)/i);
          if (riskLine) {
            const claim = riskLine[1].trim();
            const affected = affectsLine?.[1]?.trim() || '';
            const tickerMatch = affected.match(/\b([A-Z]{1,5})\b/);
            const subject = tickerMatch ? tickerMatch[1] : symbols[0] || 'portfolio';
            const r = await writeFact(userId, {
              subject,
              fact_type: 'observation',
              claim,
              confidence: 'unconfirmed',
              source: 'weekly_snapshot_test',
            });
            if (r.fact) { writtenRiskIds.push(r.fact.id); writtenCount++; }
          }
        }

        // Parse opportunities into recommendation facts
        const oppBlocks = oppText.split(/\n(?=\s*(?:[-•*]\s|\d+\.\s))/).filter(Boolean);
        for (const block of oppBlocks) {
          const whatLine = block.match(/\*\*What:\*\*\s*(.+?)(?:\n|$)/i);
          const whyLine = block.match(/\*\*Why:\*\*\s*(.+?)(?:\n|$)/i);
          if (whatLine) {
            const claimWhat = whatLine[1].trim();
            const whyText = whyLine?.[1]?.trim() || '';
            const fullClaim = whyText ? `${claimWhat} | ${whyText}` : claimWhat;
            let subject = 'portfolio';
            for (const sym of symbols) {
              if (fullClaim.toUpperCase().includes(sym.toUpperCase())) {
                subject = sym;
                break;
              }
            }
            const r = await writeFact(userId, {
              subject,
              fact_type: 'recommendation',
              claim: fullClaim,
              confidence: 'tentative',
              based_on: writtenRiskIds.length > 0 ? writtenRiskIds : null,
              source: 'weekly_snapshot_test',
            });
            if (r.fact) writtenCount++;
          }
        }

        results.push({
          assertion: '6c. Facts written back post-generation',
          passed: writtenCount > 0,
          detail: `${writtenCount} new facts written`,
        });

        // Include the snapshot preview for manual review
        results.push({
          assertion: '📋 Generated snapshot preview',
          passed: true,
          detail: content.substring(0, 500),
        });

      } catch (aiErr: any) {
        results.push({
          assertion: '6. AI generation',
          passed: false,
          detail: `callChatAI error: ${aiErr?.message || aiErr}`,
        });
      }
    }

    // Clean up seed facts
    if (seedIds.length > 0) {
      await (supabase as any).from('ai_facts').delete().in('id', seedIds);
    }

    const allPassed = results.filter((r) => !r.detail.startsWith('📋')).every((r) => r.passed);

    return NextResponse.json({
      passed: allPassed,
      assertions: results,
      summary: allPassed
        ? 'All contradiction/consistency checks passed — facts grounding working correctly.'
        : `${results.filter((r) => !r.passed).length} assertion(s) failed — check details.`,
    });

  } catch (err: any) {
    if (seedIds.length > 0) {
      await (supabase as any).from('ai_facts').delete().in('id', seedIds).catch(() => {});
    }
    return NextResponse.json({
      passed: false,
      error: err?.message || String(err),
      assertions: results,
    }, { status: 500 });
  }
}
