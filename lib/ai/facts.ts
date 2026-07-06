/**
 * lib/ai/facts.ts — Shared AI Facts memory table
 *
 * All AI generation surfaces (Daily Brief, Weekly Snapshot, greeting, chat,
 * Noticed engine) will read from this BEFORE building their prompts, and
 * write back their conclusions AFTER generation.
 *
 * This ensures future generations are grounded in what's already been
 * concluded instead of each starting from a blank slate.
 */

import { createServerClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────

export type FactType = 'observation' | 'question' | 'recommendation' | 'user_action';
export type FactConfidence = 'confirmed' | 'tentative' | 'unconfirmed';
export type FactStatus = 'active' | 'superseded' | 'resolved' | 'stale';

export interface AiFact {
  id: string;
  user_id: string;
  subject: string;
  fact_type: FactType;
  claim: string;
  confidence: FactConfidence;
  based_on: string[] | null;
  source: string;
  created_at: string;
  expires_at: string | null;
  status: FactStatus;
  superseded_by: string | null;
}

export interface WriteFactInput {
  subject: string;
  fact_type: FactType;
  claim: string;
  confidence?: FactConfidence;
  based_on?: string[] | null;
  source: string;
  expires_at?: string | null;
}

export interface FactValidationError {
  code: string;
  message: string;
}

// ── Read ──────────────────────────────────────────────────────

/**
 * Returns all active facts for a user, optionally filtered by subject.
 * Active = status = 'active' AND (expires_at IS NULL OR expires_at > now()).
 *
 * Call this BEFORE building any AI generation prompt to include as
 * grounding context in the system or user message.
 */
export async function getActiveFacts(
  supabaseOrUserId: SupabaseClient | string,
  subject?: string,
): Promise<AiFact[]> {
  const supabase =
    typeof supabaseOrUserId === 'string'
      ? createServerClient()
      : supabaseOrUserId;

  let query = (supabase as any)
    .from('ai_facts')
    .select('*')
    .eq('status', 'active')
    .or('expires_at.is.null,expires_at.gt.now()');

  if (typeof supabaseOrUserId === 'string') {
    query = query.eq('user_id', supabaseOrUserId);
  }

  if (subject) {
    query = query.eq('subject', subject);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    console.error('[ai-facts] getActiveFacts error:', error);
    return [];
  }

  return (data || []) as AiFact[];
}

// ── Write ─────────────────────────────────────────────────────

/**
 * Writes a new fact with dedup and confidence-enforcement logic.
 *
 * Before inserting:
 * 1. Checks for existing active facts on the same subject.
 * 2. If an exact duplicate (same subject + same claim text) exists, returns
 *    the existing fact id (no-op).
 * 3. If the new fact is an `observation` that contradicts an existing active
 *    observation (different claim text), the old one is superseded.
 * 4. `recommendation` facts MUST have `based_on` populated. If any fact in
 *    the based_on chain has `confidence: unconfirmed`, this recommendation's
 *    confidence is forced to `tentative`.
 * 5. `user_action` facts resolve/supersede any active `question` or
 *    `recommendation` facts on the same subject.
 *
 * Returns { fact, warnings[] }.
 */
export async function writeFact(
  supabaseOrUserId: SupabaseClient | string,
  input: WriteFactInput,
): Promise<{
  fact: AiFact | null;
  warnings: FactValidationError[];
  superseded: string[];
}> {
  const supabase =
    typeof supabaseOrUserId === 'string'
      ? createServerClient()
      : supabaseOrUserId;

  const userId =
    typeof supabaseOrUserId === 'string'
      ? supabaseOrUserId
      : null;

  const warnings: FactValidationError[] = [];
  const superseded: string[] = [];

  // ── 1. Check for exact duplicate ────────────────────────────
  const { data: existing } = await (supabase as any)
    .from('ai_facts')
    .select('*')
    .eq('subject', input.subject)
    .eq('claim', input.claim)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    return {
      fact: existing as AiFact,
      warnings: [{ code: 'DUPLICATE', message: `Fact "${input.claim}" already active for subject "${input.subject}"` }],
      superseded: [],
    };
  }

  // ── 2. Validate recommendation facts ────────────────────────
  let confidence: FactConfidence = input.confidence || 'unconfirmed';

  if (input.fact_type === 'recommendation') {
    if (!input.based_on || input.based_on.length === 0) {
      warnings.push({
        code: 'MISSING_BASED_ON',
        message: 'Recommendation fact must reference at least one observation in based_on',
      });
    }

    // Check based_on chain for unconfirmed facts
    if (input.based_on && input.based_on.length > 0) {
      const { data: basedFacts } = await (supabase as any)
        .from('ai_facts')
        .select('id,confidence,subject')
        .in('id', input.based_on);

      if (basedFacts) {
        for (const bf of basedFacts) {
          if (bf.confidence === 'unconfirmed') {
            warnings.push({
              code: 'UNCONFIRMED_CHAIN',
              message: `Recommendation based on unconfirmed fact ${bf.id} ("${bf.subject}") — confidence forced to tentative`,
            });
            confidence = 'tentative';
          }
        }

        // Also check if any open question facts exist for the same subject
        const { data: openQuestions } = await (supabase as any)
          .from('ai_facts')
          .select('id')
          .eq('subject', input.subject)
          .eq('fact_type', 'question')
          .eq('status', 'active');

        if (openQuestions && openQuestions.length > 0) {
          warnings.push({
            code: 'OPEN_QUESTION_EXISTS',
            message: `Open question fact(s) exist for "${input.subject}" — recommendation confidence forced to tentative`,
          });
          confidence = 'tentative';
        }
      }
    }
  }

  // ── 3. Handle observation contradictions ────────────────────
  if (input.fact_type === 'observation') {
    const { data: existingObs } = await (supabase as any)
      .from('ai_facts')
      .select('*')
      .eq('subject', input.subject)
      .eq('fact_type', 'observation')
      .eq('status', 'active')
      .neq('claim', input.claim);

    if (existingObs && existingObs.length > 0) {
      // Supersede all old observations on same subject
      for (const old of existingObs) {
        await (supabase as any)
          .from('ai_facts')
          .update({ status: 'superseded', superseded_by: null }) // will update once we have the new id
          .eq('id', old.id);
        superseded.push(old.id);
      }
    }
  }

  // ── 4. Handle user_action — resolve questions + recommendations
  if (input.fact_type === 'user_action') {
    const { data: toResolve } = await (supabase as any)
      .from('ai_facts')
      .select('id')
      .eq('subject', input.subject)
      .in('fact_type', ['question', 'recommendation'])
      .eq('status', 'active');

    if (toResolve) {
      for (const item of toResolve) {
        await (supabase as any)
          .from('ai_facts')
          .update({ status: 'resolved' })
          .eq('id', item.id);
        superseded.push(item.id);
      }
    }
  }

  // ── 5. Insert ───────────────────────────────────────────────
  const insertPayload: Record<string, unknown> = {
    ...(userId ? { user_id: userId } : {}),
    subject: input.subject,
    fact_type: input.fact_type,
    claim: input.claim,
    confidence,
    based_on: input.based_on || null,
    source: input.source,
    expires_at: input.expires_at || null,
    status: 'active',
  };

  const { data: inserted, error } = await (supabase as any)
    .from('ai_facts')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    console.error('[ai-facts] writeFact insert error:', error);
    return { fact: null, warnings: [...warnings, { code: 'INSERT_ERROR', message: error.message }], superseded };
  }

  const fact = inserted as AiFact;

  // ── 6. Post-insert: backfill superseded_by links ────────────
  if (superseded.length > 0) {
    await (supabase as any)
      .from('ai_facts')
      .update({ superseded_by: fact.id })
      .in('id', superseded);
  }

  return { fact, warnings, superseded };
}

// ── Utilities ─────────────────────────────────────────────────

/**
 * Formats active facts as a compact text block suitable for injecting
 * into an AI system or user prompt. Keeps it scannable.
 *
 * Example output:
 * --- AI FACTS (grounding context) ---
 * [observation·confirmed] AXP: +15.6% gain, near 52-week high
 * [question·unconfirmed] AXP: -5.1% drawdown cause not yet investigated
 * [recommendation·tentative] AXP: consider buying $350-355 level
 * --- END FACTS ---
 */
export function formatFactsForPrompt(facts: AiFact[]): string {
  if (facts.length === 0) return '';

  const lines = facts.map((f) => {
    const tag = `[${f.fact_type}·${f.confidence}]`;
    return `${tag} ${f.subject}: ${f.claim}`;
  });

  return [
    '--- AI FACTS (grounding context — use these to stay consistent) ---',
    ...lines,
    '--- END FACTS ---',
  ].join('\n');
}
