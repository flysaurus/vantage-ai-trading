/**
 * lib/ai/facts.ts — Shared AI Facts memory table
 *
 * All AI generation surfaces (Daily Brief, Weekly Snapshot, greeting, chat,
 * Noticed engine) will read from this BEFORE building their prompts, and
 * write back their conclusions AFTER generation.
 *
 * This ensures future generations are grounded in what's already been
 * concluded instead of each starting from a blank slate.
 *
 * DESIGN CHOICE — Hedge vs Block:
 * When a recommendation references an unconfirmed fact chain, we ALLOW the
 * write but force hedged language ("Pending verification: …") and tentative
 * confidence.  This is more practical than blocking: surfaces don't need to
 * handle write failures, and downstream consumers can still see + qualify
 * the recommendation.  Blocking would require every surface to implement
 * retry/rewrite logic.
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
  /** Override default expiration. NULL = structural (never expires). */
  expires_at?: string | null;
}

export interface FactValidationError {
  code: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────

const HEDGE_PREFIX = 'Pending verification: ';
const HOURS = 3600_000;

/**
 * Default expiration based on fact_type:
 *  - volatile (observation, recommendation) → 72 h
 *  - persistent (question, user_action) → NULL (never auto-expire)
 * Caller can always override via input.expires_at.
 */
function defaultExpiration(type: FactType): string | null {
  switch (type) {
    case 'observation':
    case 'recommendation':
      return new Date(Date.now() + 72 * HOURS).toISOString();
    default:
      return null;
  }
}

// ── Maintenance ───────────────────────────────────────────────

/**
 * Marks all facts whose expires_at has passed as status: 'stale'.
 * Called lazily inside getActiveFacts so no separate cron is needed.
 */
export async function markStaleFacts(
  supabase: SupabaseClient,
): Promise<number> {
  const { data, error } = await (supabase as any)
    .from('ai_facts')
    .update({ status: 'stale' })
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) {
    console.error('[ai-facts] markStaleFacts error:', error);
    return 0;
  }

  return (data || []).length;
}

// ── Read ──────────────────────────────────────────────────────

/**
 * Returns all active facts for a user, optionally filtered by subject.
 * Active = status = 'active' AND expires_at has not passed.
 *
 * Automatically marks expired facts as stale before querying.
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

  // Lazy staleness check — piggyback on every read
  await markStaleFacts(supabase);

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
 * Writes a new fact with dedup, confidence enforcement, and conflict resolution.
 *
 * Rules enforced:
 * 1. Exact duplicate detection (same subject + claim) → returns existing (no-op).
 * 2. Subject conflict → same subject + same fact_type + different claim:
 *    OLD fact is marked status: superseded, superseded_by = new fact id.
 * 3. Recommendation chain validation:
 *    - MUST have based_on populated.
 *    - If any based_on fact is `unconfirmed`, or an open question exists
 *      for the same subject → confidence forced to `tentative` AND claim
 *      is prepended with "Pending verification: …".
 * 4. user_action → resolves any active question/recommendation on the same
 *    subject (status → 'resolved').
 * 5. Auto-expiration: observation/recommendation default to 72 h,
 *    question/user_action default to NULL. Overridable via input.expires_at.
 *
 * Returns { fact, warnings[], superseded[] }.
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
  let hedged = false;

  // ── 1. Lazy stale cleanup ───────────────────────────────────
  await markStaleFacts(supabase);

  // ── 2. Check for exact duplicate ────────────────────────────
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
      warnings: [{ code: 'DUPLICATE', message: `Fact already active for "${input.subject}"` }],
      superseded: [],
    };
  }

  // ── 3. Conflict detection — supersede old facts on same subject+type ──
  const { data: conflicting } = await (supabase as any)
    .from('ai_facts')
    .select('id,claim')
    .eq('subject', input.subject)
    .eq('fact_type', input.fact_type)
    .eq('status', 'active')
    .neq('claim', input.claim);

  if (conflicting && conflicting.length > 0) {
    // Marked for post-insert supersede (need new fact id first)
    for (const old of conflicting) {
      superseded.push(old.id);
    }
  }

  // ── 4. Validate recommendation facts ────────────────────────
  let confidence: FactConfidence = input.confidence || 'unconfirmed';
  let claim = input.claim;

  if (input.fact_type === 'recommendation') {
    if (!input.based_on || input.based_on.length === 0) {
      warnings.push({
        code: 'MISSING_BASED_ON',
        message: 'Recommendation must reference at least one observation in based_on',
      });
    }

    if (input.based_on && input.based_on.length > 0) {
      const { data: basedFacts } = await (supabase as any)
        .from('ai_facts')
        .select('id,confidence,subject')
        .in('id', input.based_on);

      let chainHasUnconfirmed = false;

      if (basedFacts) {
        for (const bf of basedFacts) {
          if (bf.confidence === 'unconfirmed') {
            chainHasUnconfirmed = true;
            break;
          }
        }

        if (chainHasUnconfirmed) {
          warnings.push({
            code: 'UNCONFIRMED_CHAIN',
            message: `Recommendation based on unconfirmed fact(s) — hedged`,
          });
          confidence = 'tentative';
          hedged = true;
        }
      }

      // Also check for open question facts on same subject
      const { data: openQuestions } = await (supabase as any)
        .from('ai_facts')
        .select('id')
        .eq('subject', input.subject)
        .eq('fact_type', 'question')
        .eq('status', 'active');

      if (openQuestions && openQuestions.length > 0) {
        warnings.push({
          code: 'OPEN_QUESTION_EXISTS',
          message: `Open question(s) exist for "${input.subject}" — hedged`,
        });
        confidence = 'tentative';
        hedged = true;
      }
    }

    // Apply hedge prefix if needed
    if (hedged && !claim.startsWith(HEDGE_PREFIX)) {
      claim = HEDGE_PREFIX + claim;
    }
  }

  // ── 5. Handle user_action — resolve questions + recommendations ──
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

  // ── 6. Build & insert ───────────────────────────────────────
  const expires = input.expires_at !== undefined
    ? input.expires_at
    : defaultExpiration(input.fact_type);

  const insertPayload: Record<string, unknown> = {
    ...(userId ? { user_id: userId } : {}),
    subject: input.subject,
    fact_type: input.fact_type,
    claim,
    confidence,
    based_on: input.based_on || null,
    source: input.source,
    expires_at: expires,
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

  // ── 7. Post-insert: backfill superseded_by + resolve conflicting ──
  if (superseded.length > 0) {
    const allResolved = superseded.filter((id) => {
      // Don't touch facts already resolved by user_action path
      return true;
    });

    if (allResolved.length > 0) {
      await (supabase as any)
        .from('ai_facts')
        .update({ status: 'superseded', superseded_by: fact.id })
        .in('id', allResolved)
        .neq('status', 'resolved'); // don't overwrite user_action resolves
    }
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
 * [recommendation·tentative] AXP: Pending verification: consider buying $350-355
 * --- END FACTS ---
 *
 * FACTS WITH confidence: tentative or unconfirmed MUST be treated as
 * low-certainty. Do not restate them as definitive conclusions. If a
 * recommendation is prefixed with "Pending verification:", the AI
 * should surface the uncertainty rather than acting on it.
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
