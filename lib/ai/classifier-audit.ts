// ─── Classifier audit logging ────────────────────────────────
// Fire-and-forget append of every intent classification so routing decisions
// can be reviewed over time (find mislabels like a read-only query routed to
// portfolio_construction). Never blocks the chat path — errors are swallowed.
// ──────────────────────────────────────────────────────────────

import { createServerClient } from '@/lib/supabase';
import type { ClassifierResult } from './classifier';

export async function logClassifierAudit(
  userId: string | null | undefined,
  message: string,
  result: ClassifierResult,
): Promise<void> {
  if (!userId || userId === 'anonymous') return; // skip anonymous — no user_id to key on
  try {
    const supabase = createServerClient();
    const { error } = await (supabase as any).from('classifier_audit').insert({
      user_id: userId,
      message: (message || '').slice(0, 500),
      category: result.category,
      source: result.source,
      confidence: result.confidence,
      vehicle: result.vehicle,
      needs_search: result.needsSearch,
      search_query: result.searchQuery ?? null,
      profile_field: result.profileField ?? null,
      profile_value: result.profileValue ?? null,
    });
    if (error) console.error('[classifier-audit] insert failed:', error.message);
  } catch (e) {
    console.error('[classifier-audit] log failed:', (e as Error)?.message);
  }
}
