// ─── Order Idempotency Guard Unit Test ─────────────────────────
// Proves the server-side duplicate-order guard behaves correctly for:
//   1. dedup key derivation (AI vs manual, symbol/side normalization)
//   2. AI path → PERSISTENT rejection (any repeat of same messageId+symbol+side)
//   3. manual path → 30s window rejection, then stale-refresh allows
//   4. fail-open when the table is missing / unexpected errors
//   5. release() deletes the reservation (retry after broker rejection)
//
// Run: npx tsx lib/broker/__tests__/order-idempotency.spec.ts

export {};

import {
  computeDedupKey,
  checkIdempotency,
  releaseIdempotency,
  IDEMPOTENCY_WINDOW_MS,
} from '../order-idempotency';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

// ── Mock supabase client ───────────────────────────────────────
type InsertResult = { data?: any; error?: any };

function makeMockSupabase(opts: {
  insertResult?: InsertResult;
  existingCreatedAt?: string | null;
  updateError?: any;
} = {}) {
  const calls: string[] = [];
  const supabase = {
    from(_table: string) {
      const chain: any = {
        insert(payload: any) {
          calls.push(`insert:${JSON.stringify(payload)}`);
          return {
            select() {
              return {
                maybeSingle() {
                  return opts.insertResult ?? { data: { id: 'res-1' }, error: null };
                },
              };
            },
          };
        },
        select() {
          calls.push('select');
          return {
            eq(_col: string, _val: string) {
              calls.push('eq');
              return {
                maybeSingle() {
                  if (opts.existingCreatedAt == null) {
                    return { data: null, error: { message: 'no rows' } };
                  }
                  return { data: { created_at: opts.existingCreatedAt }, error: null };
                },
              };
            },
          };
        },
        update(_payload: any) {
          calls.push('update');
          return { eq() { calls.push('update:eq'); return Promise.resolve({ error: opts.updateError ?? null }); } };
        },
        delete() {
          calls.push('delete');
          return { eq() { calls.push('delete:eq'); return Promise.resolve({ error: null }); } };
        },
      };
      return chain;
    },
  };
  return { supabase, calls };
}

const USER = 'user-123';
const MSG = 'msg-abc';
const SYM = 'aapl';
const SIDE = 'BUY';

async function main() {
  // ── 1. dedup key derivation ──────────────────────────────────
  console.log('\n[1] computeDedupKey');
  assert(
    computeDedupKey(USER, MSG, SYM, SIDE) === 'user-123:msg-abc:AAPL:BUY',
    'AI path uses messageId',
  );
  assert(
    computeDedupKey(USER, null, SYM, SIDE) === 'user-123:manual:AAPL:BUY',
    'manual path uses literal "manual"',
  );
  assert(
    computeDedupKey(USER, MSG, 'aApL', 'buy') === 'user-123:msg-abc:AAPL:BUY',
    'symbol + side normalized to uppercase',
  );

  // ── 2. AI path → persistent rejection ────────────────────────
  console.log('\n[2] AI path (messageId present)');

  {
    const { supabase, calls } = makeMockSupabase();
    const r = await checkIdempotency(supabase, USER, MSG, SYM, SIDE);
    assert(r.allowed === true && r.dedupKey.endsWith('msg-abc:AAPL:BUY'), 'first submission → allowed');
    assert(calls.some((c) => c.startsWith('insert:')), 'reserves key via INSERT');
  }

  {
    const { supabase } = makeMockSupabase({
      insertResult: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } },
    });
    const r = await checkIdempotency(supabase, USER, MSG, SYM, SIDE);
    assert(r.allowed === false, 'AI duplicate → rejected');
    assert(r.reason === 'This order was already submitted.', 'AI duplicate has clear message');
  }

  // ── 3. manual path → 30s window ──────────────────────────────
  console.log('\n[3] manual path (no messageId)');

  {
    const { supabase } = makeMockSupabase();
    const r = await checkIdempotency(supabase, USER, null, SYM, SIDE);
    assert(r.allowed === true, 'first manual submission → allowed');
  }

  {
    const recent = new Date(Date.now() - 5_000).toISOString();
    const { supabase } = makeMockSupabase({
      insertResult: { data: null, error: { code: '23505', message: 'duplicate' } },
      existingCreatedAt: recent,
    });
    const r = await checkIdempotency(supabase, USER, null, SYM, SIDE);
    assert(r.allowed === false, 'manual duplicate within window → rejected');
  }

  {
    const stale = new Date(Date.now() - (IDEMPOTENCY_WINDOW_MS + 10_000)).toISOString();
    const { supabase, calls } = makeMockSupabase({
      insertResult: { data: null, error: { code: '23505', message: 'duplicate' } },
      existingCreatedAt: stale,
    });
    const r = await checkIdempotency(supabase, USER, null, SYM, SIDE);
    assert(r.allowed === true, 'stale manual duplicate → allowed');
    assert(calls.includes('update'), 'stale manual reservation → refreshes created_at');
  }

  // ── 4. fail-open on missing table / unexpected error ─────────
  console.log('\n[4] fail-open');

  {
    const { supabase } = makeMockSupabase({
      insertResult: { data: null, error: { code: 'PGRST205', message: 'Could not find the table' } },
    });
    const r = await checkIdempotency(supabase, USER, MSG, SYM, SIDE);
    assert(r.allowed === true, 'missing table (PGRST205) → fail open');
  }

  {
    const { supabase } = makeMockSupabase({
      insertResult: { data: null, error: { code: '42P01', message: 'relation does not exist' } },
    });
    const r = await checkIdempotency(supabase, USER, MSG, SYM, SIDE);
    assert(r.allowed === true, 'missing table (42P01) → fail open');
  }

  {
    const { supabase } = makeMockSupabase({
      insertResult: { data: null, error: { code: 'XX000', message: 'some db hiccup' } },
    });
    const r = await checkIdempotency(supabase, USER, MSG, SYM, SIDE);
    assert(r.allowed === true, 'unexpected insert error → fail open (never block trades)');
  }

  // ── 5. release deletes the reservation ───────────────────────
  console.log('\n[5] releaseIdempotency');
  {
    const { supabase, calls } = makeMockSupabase();
    await releaseIdempotency(supabase, 'user-123:msg-abc:AAPL:BUY');
    assert(calls.includes('delete') && calls.includes('delete:eq'), 'release → DELETE by dedup_key');
  }

  console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test runner error:', e);
  process.exit(1);
});
