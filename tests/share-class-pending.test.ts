import { describe, it, expect } from 'vitest';
import {
  createPendingAction,
  getPendingAction,
  cancelPendingActionsForSymbols,
  blockShareClassTickets,
} from '@/lib/ai/pending-actions';

// ── A minimal in-memory double of the service-role Supabase chain we use ─────
// Supports exactly the shapes pending-actions.ts issues:
//   update().eq().eq()[.lt()]                              (thenable, no select)
//   insert(row).select('*').single()
//   select('*').eq().eq().order().limit(1).maybeSingle()
//   update(patch).eq().eq().in(col, vals).select('id, confirm_token')
type Row = Record<string, any>;

function fakeDb(initial: Row[] = []) {
  const rows: Row[] = initial.map((r) => ({ ...r }));

  function query() {
    const ctx: any = {
      op: 'select',
      patch: null,
      cols: '*',
      single: false,
      filters: [] as ((r: Row) => boolean)[],
      row: null,
    };
    const exec = () => {
      const hit = rows.filter((r: Row) => ctx.filters.every((f: (row: Row) => boolean) => f(r)));
      if (ctx.op === 'insert') {
        const inserted: Row = {
          id: `pa_${rows.length + 1}`,
          created_at: new Date().toISOString(),
          ...ctx.row,
        };
        rows.push(inserted);
        return { data: ctx.single ? inserted : [inserted], error: null };
      }
      if (ctx.op === 'update') {
        for (const r of hit) Object.assign(r, ctx.patch);
        if (String(ctx.cols).includes('confirm_token')) {
          return { data: hit.map((r) => ({ id: r.id, confirm_token: r.confirm_token })), error: null };
        }
        return { data: ctx.single ? (hit[0] ?? null) : hit, error: null };
      }
      return { data: ctx.single ? (hit[0] ?? null) : hit, error: null };
    };
    const api: any = {
      select(cols = '*') {
        ctx.cols = cols;
        return api;
      },
      update(patch: Row) {
        ctx.op = 'update';
        ctx.patch = patch;
        return api;
      },
      insert(row: Row) {
        ctx.op = 'insert';
        ctx.row = row;
        return api;
      },
      eq(col: string, val: any) {
        ctx.filters.push((r: Row) => r[col] === val);
        return api;
      },
      in(col: string, vals: any[]) {
        ctx.filters.push((r: Row) => vals.includes(r[col]));
        return api;
      },
      lt(col: string, val: any) {
        ctx.filters.push((r: Row) => r[col] < val);
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      single() {
        ctx.single = true;
        return api;
      },
      maybeSingle() {
        ctx.single = true;
        return api;
      },
      then(res: any, rej: any) {
        return Promise.resolve(exec()).then(res, rej);
      },
      catch(rej: any) {
        return Promise.resolve(exec()).catch(rej);
      },
    };
    return api;
  }

  return { supabase: { from: () => query() }, rows };
}

const USER = '58ffa82a-2b14-4a5d-9662-5c48f105031f';

/** Stage a money-tool preview exactly the way the real flow does. */
async function stageBuy(sb: any, symbol: string, amount = 500) {
  return createPendingAction(sb, USER, {
    actionType: 'buy_stock',
    payload: { symbol, dollarAmount: amount },
    summary: `Buy $${amount} of ${symbol}.`,
    amountUsd: amount,
    confirmToken: symbol,
  });
}

/** The REAL shared helper route.ts calls on both branches (`shareClassBlockWithCancel`). */
async function runGuardPipeline(sb: any, text: string, held: string[]) {
  const res = await blockShareClassTickets(() => sb, USER, text, held);
  return { pruned: res.text, stripped: res.stripped, cancelled: res.cancelled };
}

/**
 * Mirror of route.ts `cancelBlockedOnReject` — the REJECTED branch. Same helper,
 * but the returned (pruned) text is deliberately discarded: the client dropped
 * this attempt and is regenerating, so nothing from it is ever rendered.
 */
async function runRejectedBranch(sb: any, text: string, held: string[]) {
  await blockShareClassTickets(() => sb, USER, text, held);
}

const RESPONSE =
  '[SUMMARY_TLDR: $1,500 across three positions — $500 AVGO (~1.5 shares), $500 GOOG (~1.5 shares), $500 XOM (~3 shares)]\n' +
  '[RECOMMEND:AVGO:BUY:$500] [RECOMMEND:GOOG:BUY:$500] [RECOMMEND:XOM:BUY:$500]\n' +
  'Reply **"confirm GOOG"** to buy GOOG';

describe('cancelPendingActionsForSymbols', () => {
  it('cancels the staged ticket and returns its confirm token', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    expect((await getPendingAction(db.supabase, USER))?.confirmToken).toBe('GOOG');

    const cancelled = await cancelPendingActionsForSymbols(db.supabase, USER, ['GOOG']);

    expect(cancelled).toEqual(['GOOG']);
    expect(await getPendingAction(db.supabase, USER)).toBeNull();
    expect(db.rows.find((r) => r.confirm_token === 'GOOG')?.status).toBe('cancelled');
  });

  it('is a no-op for an empty symbol list and touches nothing', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'AVGO');
    expect(await cancelPendingActionsForSymbols(db.supabase, USER, [])).toEqual([]);
    expect(db.rows[0].status).toBe('pending');
  });

  it('normalises case/whitespace and never cancels a non-matching symbol', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    await cancelPendingActionsForSymbols(db.supabase, USER, []);
    expect(await cancelPendingActionsForSymbols(db.supabase, USER, [' goog '])).toEqual(['GOOG']);
    expect(db.rows[0].status).toBe('cancelled');
  });

  it('leaves another user’s identical ticket alone', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    const otherToken = await cancelPendingActionsForSymbols(db.supabase, 'someone-else', ['GOOG']);
    expect(otherToken).toEqual([]);
    expect(db.rows[0].status).toBe('pending');
  });
});

describe('END-TO-END: staged ticket + guard pipeline → row actually cancelled', () => {
  it('stages GOOG the way previewBuyStock does, runs the guard, and the row is cancelled', async () => {
    const db = fakeDb();
    // 1. the model's money tool stages a REAL ticket
    const staged = await stageBuy(db.supabase, 'GOOG');
    expect(staged?.status).toBe('pending');
    expect(db.rows).toHaveLength(1);

    // 2. the same turn's response carries the conflicting marker (user holds GOOGL)
    const { pruned, stripped, cancelled } = await runGuardPipeline(db.supabase, RESPONSE, ['GOOGL']);

    // 3. the text is fixed…
    expect(stripped[0]).toMatchObject({ symbol: 'GOOG', sibling: 'GOOGL', held: true });
    expect(pruned).not.toContain('[RECOMMEND:GOOG');
    expect(pruned).not.toContain('confirm GOOG');
    expect(pruned).toContain('two positions');

    // 4. …and the stale ticket can no longer be executed by a typed "confirm GOOG"
    expect(cancelled).toEqual(['GOOG']);
    expect(db.rows.filter((r) => r.status === 'pending')).toHaveLength(0);
    expect(await getPendingAction(db.supabase, USER)).toBeNull();
  });

  it('keeps a legitimate staged ticket for a surviving symbol in the same response', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    await stageBuy(db.supabase, 'XOM'); // supersedes GOOG, as the real invariant does

    const { cancelled } = await runGuardPipeline(db.supabase, RESPONSE, ['GOOGL']);

    expect(cancelled).toEqual([]); // the live ticket is XOM, which is legitimate
    const pending = await getPendingAction(db.supabase, USER);
    expect(pending?.confirmToken).toBe('XOM');
  });

  it('does nothing at all when the response has no conflicting marker', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'AVGO');
    const clean = 'Buying AVGO.\n[RECOMMEND:AVGO:BUY:$500]\nReply **"confirm AVGO"** to execute.';

    const { cancelled, pruned } = await runGuardPipeline(db.supabase, clean, ['GOOGL']);

    expect(cancelled).toEqual([]);
    expect(pruned).toBe(clean);
    expect((await getPendingAction(db.supabase, USER))?.confirmToken).toBe('AVGO');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The REJECTED branch (regenerate path). A failed validation makes the client
// throw the whole attempt away and silently retry — so the text (and its
// markers) never reach the user. The staged ticket, however, is a real DB row
// that a typed `confirm <SYM>` would still execute. Same helper, one more call
// site: the cancel must run even though nothing is rendered.
// ─────────────────────────────────────────────────────────────────────────────
describe('REJECTED branch: the discarded response still cancels its staged ticket', () => {
  it('cancels the blocked symbol’s ticket even though the rejected text never renders', async () => {
    const db = fakeDb();
    const staged = await stageBuy(db.supabase, 'GOOG'); // staged by previewBuyStock
    expect(staged?.status).toBe('pending');
    expect(db.rows).toHaveLength(1);

    // Validation rejected this attempt (budget_reconciliation etc.) → the client
    // discards it. The pruned text is intentionally NOT used on this branch.
    await runRejectedBranch(db.supabase, RESPONSE, ['GOOGL']);

    // The ticket is dead even though the user never saw a single character.
    expect(db.rows[0].status).toBe('cancelled');
    expect(await getPendingAction(db.supabase, USER)).toBeNull();
    // ⇒ a typed "confirm GOOG" now finds no ticket and cannot execute the order.
  });

  it('leaves a non-conflicting ticket alive when the rejected response is fine', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'AVGO');
    const clean = 'Buying AVGO.\n[RECOMMEND:AVGO:BUY:$500]';
    await runRejectedBranch(db.supabase, clean, ['GOOGL']);
    expect(db.rows[0].status).toBe('pending');
  });

  it('cancels only the blocked symbol when the rejected response also stages a survivor', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    const live = await stageBuy(db.supabase, 'XOM'); // supersedes GOOG
    expect(live?.confirmToken).toBe('XOM');

    await runRejectedBranch(db.supabase, RESPONSE, ['GOOGL']);

    expect((await getPendingAction(db.supabase, USER))?.confirmToken).toBe('XOM');
    expect(db.rows.find((r) => r.confirm_token === 'GOOG')?.status).toBe('cancelled');
  });

  it('never builds a DB client when the rejected text carries no markers', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    let clientCalls = 0;
    const res = await blockShareClassTickets(
      () => {
        clientCalls += 1;
        return db.supabase;
      },
      USER,
      'Validation failed — no markers here.',
      ['GOOGL'],
    );
    expect(clientCalls).toBe(0);
    expect(res.cancelled).toEqual([]);
    expect(db.rows[0].status).toBe('pending');
  });

  it('is a no-op for an anonymous user (no userId) on the rejected branch', async () => {
    const db = fakeDb();
    await stageBuy(db.supabase, 'GOOG');
    const res = await blockShareClassTickets(() => db.supabase, 'anonymous', RESPONSE, ['GOOGL']);
    expect(res.cancelled).toEqual([]);
    expect(res.text).not.toContain('[RECOMMEND:GOOG');
    expect(db.rows[0].status).toBe('pending');
  });
});
