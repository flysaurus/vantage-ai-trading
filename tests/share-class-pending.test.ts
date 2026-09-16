import { describe, it, expect } from 'vitest';
import {
  createPendingAction,
  getPendingAction,
  cancelPendingActionsForSymbols,
} from '@/lib/ai/pending-actions';
import { stripConflictingRecommendMarkers } from '@/lib/ai/share-class';

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
      const hit = rows.filter((r) => ctx.filters.every((f) => f(r)));
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
        ctx.filters.push((r) => r[col] === val);
        return api;
      },
      in(col: string, vals: any[]) {
        ctx.filters.push((r) => vals.includes(r[col]));
        return api;
      },
      lt(col: string, val: any) {
        ctx.filters.push((r) => r[col] < val);
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

/** Mirror of route.ts `shareClassBlockWithCancel` (the real integration point). */
async function runGuardPipeline(sb: any, text: string, held: string[]) {
  const { text: pruned, stripped } = stripConflictingRecommendMarkers(text, held);
  const cancelled = stripped.length
    ? await cancelPendingActionsForSymbols(sb, USER, stripped.map((s) => s.symbol))
    : [];
  return { pruned, stripped, cancelled };
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
