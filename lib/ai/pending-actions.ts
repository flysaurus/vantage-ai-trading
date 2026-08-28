// ─── Pending Actions (plan-then-confirm gate) ────────────────────────────────
// Backs the AI-advisor confirm gate. Money tools are PREVIEW-ONLY: they validate
// the request and store a short-lived `pending_action` ticket here, then return
// a preview to the model (which summarizes it and asks the user to confirm).
//
// A separate DETERMINISTIC confirm step (never the LLM) looks the ticket up and
// runs the real endpoint via lib/ai/executors.ts.
//
// Invariants:
//   - ~5 min TTL — a stale preview can never be confirmed.
//   - ONE outstanding pending action per user (enforced by a partial unique
//     index); creating a new preview supersedes the old one.
//   - status ∈ { pending, executed, cancelled, expired }.
//
// All access is service-role (RLS disabled + anon/authenticated revoked).
// ─────────────────────────────────────────────────────────────────────────────

export type PendingStatus = 'pending' | 'executed' | 'cancelled' | 'expired';

export interface PendingAction {
  id: string;
  userId: string;
  actionType: string;
  payload: Record<string, unknown>;
  summary: string;
  amountUsd: number | null;
  confirmToken: string | null;
  status: PendingStatus;
  idempotencyKey: string;
  expiresAt: string;
  createdAt: string;
  executedAt: string | null;
}

export const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface Row {
  id: string;
  user_id: string;
  action_type: string;
  payload: Record<string, unknown>;
  summary: string;
  amount_usd: number | null;
  confirm_token: string | null;
  status: PendingStatus;
  idempotency_key: string;
  expires_at: string;
  created_at: string;
  executed_at: string | null;
}

function mapRow(row: Row): PendingAction {
  return {
    id: row.id,
    userId: row.user_id,
    actionType: row.action_type,
    payload: row.payload ?? {},
    summary: row.summary ?? '',
    amountUsd: row.amount_usd ?? null,
    confirmToken: row.confirm_token ?? null,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    executedAt: row.executed_at ?? null,
  };
}

export interface CreatePendingActionOpts {
  actionType: string;
  payload: Record<string, unknown>;
  summary: string;
  amountUsd?: number | null;
  confirmToken?: string | null;
}

/**
 * Create a pending-action ticket. Supersedes any existing pending action for
 * the user (the "one outstanding action" invariant), so a new preview always
 * invalidates the previous one.
 */
export async function createPendingAction(
  supabase: any,
  userId: string,
  opts: CreatePendingActionOpts,
): Promise<PendingAction | null> {
  try {
    // Supersede: cancel any currently-pending action for this user.
    await (supabase as any)
      .from('pending_actions')
      .update({ status: 'cancelled' })
      .eq('user_id', userId)
      .eq('status', 'pending');

    const { data, error } = await (supabase as any)
      .from('pending_actions')
      .insert({
        user_id: userId,
        action_type: opts.actionType,
        payload: opts.payload,
        summary: opts.summary,
        amount_usd: opts.amountUsd ?? null,
        confirm_token: opts.confirmToken ?? null,
        status: 'pending',
        idempotency_key: crypto.randomUUID(),
        expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      console.error('[pending-actions] create failed:', error.message);
      return null;
    }
    return mapRow(data as Row);
  } catch (e) {
    console.error('[pending-actions] create threw:', e);
    return null;
  }
}

/**
 * Fetch the user's single outstanding pending action, auto-expiring stale ones
 * first. Returns null if none is pending.
 */
export async function getPendingAction(
  supabase: any,
  userId: string,
): Promise<PendingAction | null> {
  try {
    // Expire stale tickets (TTL passed).
    await (supabase as any)
      .from('pending_actions')
      .update({ status: 'expired' })
      .eq('user_id', userId)
      .eq('status', 'pending')
      .lt('expires_at', new Date().toISOString());

    const { data } = await (supabase as any)
      .from('pending_actions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data ? mapRow(data as Row) : null;
  } catch (e) {
    console.error('[pending-actions] get threw:', e);
    return null;
  }
}

/**
 * Atomically transition a pending action to a terminal status. For 'executed',
 * uses a conditional UPDATE (WHERE status='pending') so a double-tap cannot
 * execute twice. Returns the updated row, or null if the row was already in a
 * terminal state (i.e. the action was already handled).
 */
export async function markPendingAction(
  supabase: any,
  id: string,
  status: PendingStatus,
): Promise<PendingAction | null> {
  try {
    const update: Record<string, unknown> = { status };
    if (status === 'executed') update.executed_at = new Date().toISOString();

    const { data, error } = await (supabase as any)
      .from('pending_actions')
      .update(update)
      .eq('id', id)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[pending-actions] mark failed:', error.message);
      return null;
    }
    return data ? mapRow(data as Row) : null;
  } catch (e) {
    console.error('[pending-actions] mark threw:', e);
    return null;
  }
}
