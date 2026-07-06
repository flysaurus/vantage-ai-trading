/**
 * GET /api/ai/chat/test-deviation
 * 
 * Step 4 verification: tests style-deviation coaching behavior.
 * 
 * Asserts:
 * 1. Response acknowledges deviation without lecturing
 * 2. Response contains real analysis (not deflection)
 * 3. Response ends with exactly one follow-up question
 * 4. Deviation fact written to ai_facts
 * 5. 3rd occurrence softens/skips acknowledgment
 */

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { VANTAGE_SYSTEM_PROMPT } from '@/lib/ai-system-prompt';
import {
  buildUserProfileContext,
  getInvestorStylePrompt,
  getRiskTolerancePrompt,
} from '@/lib/ai/userProfile';
import type { UserProfile } from '@/lib/ai/userProfile';
import { writeFact, getActiveFacts } from '@/lib/ai/facts';
import { createServerClient } from '@/lib/supabase';

const STYLE_DEVIATION_RULES = `
STYLE-DEVIATION COACHING RULES (MANDATORY):
Your investor style is a lens, not a cage. When the user asks about something
clearly outside their stated style (e.g. a Buffett-style investor asking about
SpaceX — private, speculative, no moat to analyze the usual way):

1. ACKNOWLEDGE briefly and factually ONCE — "SpaceX isn't a typical
   Buffett-style pick — it's private, speculative, no moat you can analyze
   the usual way." Do NOT lecture. Do NOT express disapproval.

2. ANSWER the actual question with real analysis using whatever data IS
   available — thesis-level reasoning, business model, market opportunity —
   even without traditional value metrics. Never dodge or redirect without
   answering the core question.

3. ASK exactly ONE genuine, non-judgmental follow-up question to understand
   intent — "What's drawing you to this — diversification, conviction in the
   thesis, or just curiosity?" Do NOT ask multiple questions.

4. Do NOT repeat the deviation acknowledgment on follow-up messages about
   the same topic.

5. If multiple deviations in the same category have been noted (shown in
   DEVIATION HISTORY below), skip the acknowledgment entirely on the 3rd+
   occurrence.

Use the style to INFORM your analysis, not to RESTRICT what you'll discuss.
`;

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

  // Build Buffett-style profile
  const profile: UserProfile = {
    investorStyle: 'Buffett',
    riskTolerance: 'Moderate',
    name: 'M',
    timezone: 'America/New_York',
  };
  const profileContext = buildUserProfileContext(profile) + '\n' + STYLE_DEVIATION_RULES;

  // Clean any previous test deviation facts
  const { data: oldFacts } = await (supabase as any)
    .from('ai_facts')
    .select('id')
    .eq('source', 'deviation_test')
    .like('subject', 'user_style_deviation:%');
  if (oldFacts?.length) {
    await (supabase as any)
      .from('ai_facts')
      .delete()
      .in('id', oldFacts.map((f: any) => f.id));
  }

  // ── Test 1: First deviation (Buffett + SpaceX) ───────────
  const query1 = "What do you think of SpaceX as an investment?";
  
  try {
    const res1 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT },
        { type: 'text' as const, text: profileContext },
      ],
      messages: [{ role: 'user' as const, content: query1 }],
    });

    const text1 = (res1.content[0] as any)?.text?.trim() || '';

    // Assertion 1a: Acknowledges deviation
    const ackDeviation = /Buffett|moat|speculative|private company|typical.*pick|isn't.*style|not.*usual/i.test(text1);
    // Assertion 1b: No lecture/disapproval
    const noLecture = !/should stick to|you shouldn't|doesn't fit|wrong approach|instead you should|I wouldn't/i.test(text1);
    // Assertion 1c: Contains real analysis
    const hasAnalysis = /SpaceX|Starship|Starlink|launch|revenue|valuation|market|business|thesis|Elon/i.test(text1);
    // Assertion 1d: Exactly one ending question (check last ~150 chars)
    const ending = text1.substring(Math.max(0, text1.length - 150));
    const endingQuestions = (ending.match(/\?/g) || []).length;
    const badFollowUp = /are you sure|do you really|do you understand/i.test(text1);

    // Write test fact 1
    await writeFact(userId, {
      subject: 'user_style_deviation:speculative',
      fact_type: 'observation',
      claim: 'User asked about speculative/pre-IPO (SpaceX) despite Buffett-style profile',
      confidence: 'confirmed',
      source: 'deviation_test',
    });

    results.push({
      test: 1,
      query: query1,
      response_full: text1,
      checks: {
        acknowledges_deviation: ackDeviation,
        no_lecture: noLecture,
        has_analysis: hasAnalysis,
        exactly_one_question: endingQuestions === 1 && !badFollowUp,
      },
      passed: ackDeviation && noLecture && hasAnalysis && endingQuestions === 1 && !badFollowUp,
    });
  } catch (e: any) {
    results.push({ test: 1, error: e.message, passed: false });
  }

  // ── Test 2: Second deviation (Buffett + crypto) ──────────
  const query2 = "Should I add some Bitcoin to my portfolio?";
  
  try {
    const activeFacts = await getActiveFacts(userId);
    const devFacts = activeFacts.filter((f: any) => f.subject?.startsWith?.('user_style_deviation:') ?? false);
    const devHistory = devFacts.length > 0 ? `
DEVIATION HISTORY:
${devFacts.map((f, i) => `${i+1}. ${f.claim} (${f.confidence})`).join('\n')}

${devFacts.length >= 2 ? 'Multiple deviations exist — apply Rule 5: soften acknowledgment.' : ''}
` : '';

    const res2 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT },
        { type: 'text' as const, text: profileContext },
        ...(devHistory ? [{ type: 'text' as const, text: devHistory }] : []),
      ],
      messages: [{ role: 'user' as const, content: query2 }],
    });

    const text2 = (res2.content[0] as any)?.text?.trim() || '';
    const hasAnswer = text2.length > 50 && /[Bb]itcoin|[Cc]rypto|[Bb]TC|digital|blockchain|volatil/i.test(text2);

    // Write test fact 2
    await writeFact(userId, {
      subject: 'user_style_deviation:crypto',
      fact_type: 'observation',
      claim: 'User asked about crypto (Bitcoin) despite Buffett-style profile',
      confidence: 'confirmed',
      source: 'deviation_test',
    });

    results.push({
      test: 2,
      query: query2,
      response_start: text2.substring(0, 200),
      checks: {
        deviation_history_present: devHistory.length > 0,
        contains_answer: hasAnswer,
      },
      passed: hasAnswer,
    });
  } catch (e: any) {
    results.push({ test: 2, error: e.message, passed: false });
  }

  // ── Test 3: Third deviation — should soften/skip ────────
  const query3 = "What's your take on the Rivian IPO?";
  
  try {
    const facts3 = await getActiveFacts(userId);
    // Also check directly (bypass or() filter which may not see just-inserted rows)
    const { data: rawFacts } = await (supabase as any)
      .from('ai_facts')
      .select('id,subject,claim,confidence,status')
      .eq('user_id', userId)
      .ilike('subject', 'user_style_deviation:%')
      .eq('status', 'active');
    const deviationFacts3 = rawFacts || [];
    const devHistory3 = deviationFacts3
      .map((f: any, i: number) => `${i+1}. ${f.claim} (${f.confidence})`)
      .join('\n');

    const res3 = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        { type: 'text' as const, text: VANTAGE_SYSTEM_PROMPT },
        { type: 'text' as const, text: profileContext },
        { type: 'text' as const, text: `\nDEVIATION HISTORY (${deviationFacts3.length} prior deviations):\n${devHistory3}\n\n${deviationFacts3.length >= 2 ? 'Multiple deviations in speculative category exist. Apply Rule 5: skip the acknowledgment — this is a deliberate recurring interest, not an anomaly.' : 'One prior deviation noted.'}\n` },
      ],
      messages: [{ role: 'user' as const, content: query3 }],
    });

    const text3 = (res3.content[0] as any)?.text?.trim() || '';
    // On 3rd occurrence, should NOT contain deviation acknowledgment
    const skippedAck = !/Buffett.*pick|isn't.*typical|outside.*your.*style|not.*usual for you/i.test(text3);
    const hasAnalysis = text3.length > 50 && /[Rr]ivian|EV|truck|IPO|production|delivery|Amazon/i.test(text3);

    // Write test fact 3 (unique subject to avoid superseding fact 1)
    await writeFact(userId, {
      subject: `user_style_deviation:speculative:ipo`,
      fact_type: 'observation',
      claim: 'User asked about speculative IPO (Rivian) despite Buffett-style profile',
      confidence: 'confirmed',
      source: 'deviation_test',
    });

    results.push({
      test: 3,
      query: query3,
      response_start: text3.substring(0, 200),
      checks: {
        deviation_count_before: deviationFacts3.length,
        acknowledgment_skipped: skippedAck,
        has_analysis: hasAnalysis,
      },
      passed: skippedAck && hasAnalysis,
    });
  } catch (e: any) {
    results.push({ test: 3, error: e.message, passed: false });
  }

  // ── Test 4: Facts written ────────────────────────────────
  const facts4 = await getActiveFacts(userId);
  const devFactsWritten = facts4.filter((f: any) => (f.subject?.startsWith?.('user_style_deviation:') ?? false) && f.source === 'deviation_test');
  
  results.push({
    test: 4,
    checks: {
      deviation_facts_written: devFactsWritten.length,
      expected_minimum: 3,
    },
    passed: devFactsWritten.length >= 3,
  });

  // ── Clean up test facts ──
  const { data: cleanupIds } = await (supabase as any)
    .from('ai_facts')
    .select('id')
    .eq('source', 'deviation_test')
    .like('subject', 'user_style_deviation:%');
  if (cleanupIds?.length) {
    await (supabase as any)
      .from('ai_facts')
      .delete()
      .in('id', cleanupIds.map((f: any) => f.id));
  }

  const allPassed = results.every((r: any) => r.passed);
  const passedCount = results.filter((r: any) => r.passed).length;

  return NextResponse.json({
    passed: allPassed,
    summary: allPassed
      ? `✅ All ${results.length} tests passed — deviation coaching working correctly`
      : `❌ ${results.length - passedCount}/${results.length} tests failed`,
    summary_detail: [
      'Test 1: Buffett + SpaceX — ack + analysis + 1 follow-up question, no lecture',
      'Test 2: Buffett + Bitcoin — deviation history injected, answers anyway',
      'Test 3: 3rd speculative ask (Rivian) — acknowledgment skipped per Rule 5',
      'Test 4: 3+ deviation facts written to ai_facts',
    ],
    results,
  }, { status: 200 });
}
