// ─── Server-side order idempotency guard ─────────────────────
// Prevents duplicate REAL orders. A client-side disabled button is NOT
// enough — this is the server-side last line of defense.
//
// Key design:
//   - AI path (messageId present): PERSISTENT. A recommendation (messageId)
//     may only execute once per (symbol, side). Any repeat → reject. This
//     handles a ~49s-apart retry (UI confusion) as well as sub-second taps.
//   - Manual path (no messageId): time-window only. Reject identical
//     (symbol, side) re-submissions within IDEMPOTENCY_WINDOW_MS, then allow.
//
// Reserve-then-confirm:
//   INSERT (UNIQUE dedup_key) BEFORE placing the order. The DB UNIQUE
//   constraint makes this atomic — of two concurrent POSTs, exactly one wins
//   the reservation and places the order; the loser is rejected with 409.
//   On placement FAILURE the winner RELEASES the reservation so a legitimate
//   retry is possible. On success the reservation is kept (the order happened).
//
// Fail-open: if the table is missing (migration 045 not applied) or the guard
// itself errors, we return `allowed: true` — a broken guard must never block
// legitimate trading.

export const IDEMPOTENCY_WINDOW_MS = 30_000;

export function computeDedupKey(
  userId: string,
  messageId: string | null | undefined,
  symbol: string,
  side: string,
): string {
  const base = messageId ? messageId : 'manual';
  return `${userId}:${base}:${symbol.toUpperCase()}:${side.toUpperCase()}`;
}

export interface IdempotencyCheck {
  allowed: boolean;
  dedupKey: string;
  reason?: string;
}

/**
 * Reserves the idempotency key for a pending order placement.
 * Returns { allowed: false, reason } when this submission is a duplicate.
 */
export async function checkIdempotency(
  supabase: any,
  userId: string,
  messageId: string | null | undefined,
  symbol: string,
  side: string,
): Promise<IdempotencyCheck> {
  const dedupKey = computeDedupKey(userId, messageId, symbol, side);
  const isAiTrade = !!messageId;

  try {
    const { data: inserted, error: insErr } = await supabase
      .from('order_idempotency')
      .insert({ user_id: userId, dedup_key: dedupKey })
      .select('id')
      .maybeSingle();

    if (!insErr && inserted) {
      // Fresh reservation — first submission, allowed.
      return { allowed: true, dedupKey };
    }

    if (insErr) {
      const code = (insErr as any)?.code;
      const msg = String(insErr?.message || '');
      // Unique violation → a reservation already exists for this key.
      if (code !== '23505') {
        // Table missing (migration 045 pending) or any other error → fail open.
        if (code === 'PGRST205' || code === '42P01' || msg.includes('does not exist')) {
          console.warn('[order-idempotency] table missing — guard inactive (migration 045 pending).');
        } else {
          console.error('[order-idempotency] reserve error — failing open:', msg);
        }
        return { allowed: true, dedupKey };
      }
      // Fall through to conflict handling (23505).
    }

    // Conflict (23505 or empty result) — a reservation already exists.
    if (isAiTrade) {
      // Persistent: same recommendation (messageId) already executed.
      return {
        allowed: false,
        dedupKey,
        reason: 'This order was already submitted.',
      };
    }

    // Manual path — check the time window.
    const { data: existing } = await supabase
      .from('order_idempotency')
      .select('created_at')
      .eq('dedup_key', dedupKey)
      .maybeSingle();

    const created = existing?.created_at ? new Date(existing.created_at).getTime() : 0;
    const age = Date.now() - created;
    if (age < IDEMPOTENCY_WINDOW_MS) {
      return {
        allowed: false,
        dedupKey,
        reason: 'This order was already submitted.',
      };
    }

    // Stale manual reservation → refresh timestamp and allow.
    await supabase
      .from('order_idempotency')
      .update({ created_at: new Date().toISOString() })
      .eq('dedup_key', dedupKey);

    return { allowed: true, dedupKey };
  } catch (err) {
    // Never block a trade because the guard itself errored.
    console.error('[order-idempotency] unexpected error — failing open:', (err as Error)?.message);
    return { allowed: true, dedupKey };
  }
}

/**
 * Releases a reservation (e.g. when the broker rejected the order), so the
 * user can retry. No-op if the key is missing.
 */
export async function releaseIdempotency(
  supabase: any,
  dedupKey: string,
): Promise<void> {
  try {
    await supabase.from('order_idempotency').delete().eq('dedup_key', dedupKey);
  } catch (err) {
    console.error('[order-idempotency] release failed:', (err as Error)?.message);
  }
}
