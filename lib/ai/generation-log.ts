/**
 * lib/ai/generation-log.ts — Shared generation audit wrapper
 *
 * Every AI generation surface that reads ai_facts before building a prompt
 * and writes facts back afterward should use this helper. It:
 * 1. Calls getActiveFacts + formatFactsForPrompt (read)
 * 2. Returns them for injection into the Claude prompt
 * 3. Provides a flush() callback that writes to ai_generation_log
 *    after generation completes (async fire-and-forget)
 *
 * This is ONLY active when ADMIN_ACCESS_CODE is set in env — otherwise
 * it's a no-op passthrough to avoid overhead in production.
 */

import { getActiveFacts, formatFactsForPrompt } from '@/lib/ai/facts';
import { createServerClient } from '@/lib/supabase';
import type { AiFact } from '@/lib/ai/facts';

export interface GenLogContext {
  /** The formatted prompt context for injection into Claude system prompt */
  factsPrompt: string;
  /** Raw facts for reference / debugging */
  factsRead: AiFact[];
  /** Call after AI generation completes to log written facts and record the event */
  flush: (writtenFacts: Array<{ subject: string; claim: string; fact_type: string; id?: string }>) => void;
}

const ADMIN_CODE = process.env.ADMIN_ACCESS_CODE;

function isActive(): boolean {
  return !!ADMIN_CODE;
}

/**
 * Read facts for a generation surface and return the prompt context.
 * Call `flush()` after generation to record the event.
 *
 * When ADMIN_ACCESS_CODE is not set, returns an empty prompt (no-op).
 */
export async function beginGenLog(
  userId: string,
  surface: string,
): Promise<GenLogContext> {
  if (!isActive()) {
    return {
      factsPrompt: '',
      factsRead: [],
      flush: () => {},
    };
  }

  const facts = await getActiveFacts(userId);
  const prompt = formatFactsForPrompt(facts);

  const flush = (writtenFacts: Array<{ subject: string; claim: string; fact_type: string; id?: string }>) => {
    // Fire-and-forget — never blocks the response to the user
    const supabase = createServerClient() as any;
    supabase
      .from('ai_generation_log')
      .insert({
        user_id: userId,
        surface,
        facts_read: facts.map(f => ({
          id: f.id, subject: f.subject, fact_type: f.fact_type,
          claim: f.claim, confidence: f.confidence, source: f.source, status: f.status,
        })),
        prompt_context: prompt,
        facts_written: writtenFacts,
      })
      .then(() => { /* silent */ })
      .catch((e: any) => {
        // Table might not exist yet — that's fine, just log
        if (!e?.message?.includes('does not exist')) {
          console.error('[gen-log] Failed to write generation log:', e?.message || e);
        }
      });
  };

  return {
    factsPrompt: prompt,
    factsRead: facts,
    flush,
  };
}
