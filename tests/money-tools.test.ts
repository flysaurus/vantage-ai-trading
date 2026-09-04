// ═══════════════════════════════════════════════════════════════
// tests/money-tools.test.ts — Phase 2b/2c preview-only money tools
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/money-tools.test.ts
//
// Covers executeMoneyTool. The core safety property under test: a money tool
// NEVER executes a side effect — it validates the request and stages a
// short-lived pending_action (plan-then-confirm gate). Validation failures and
// anonymous calls return an error WITHOUT touching supabase.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { executeMoneyTool, type MoneyToolContext } from '../lib/ai/money-tools';

function makePendingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'p1',
    user_id: 'u1',
    action_type: 'buy_stock',
    payload: { symbol: 'AAPL' },
    summary: 'Buy $100.00 of AAPL.',
    amount_usd: 100,
    confirm_token: 'AAPL',
    status: 'pending',
    idempotency_key: 'k1',
    expires_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    executed_at: null,
    ...overrides,
  };
}

// Thenable mock: `await` anywhere in the fluent chain resolves to the table
// result. createPendingAction() does a supersede UPDATE (result unused) then an
// INSERT ... select('*').single() (result destructured) — both resolve to the
// same configured row, which is fine because the update's result is ignored.
function mockSupabase() {
  const row = makePendingRow();
  const from = (table: string) => {
    const builder: any = {
      then(resolve: any) { return resolve({ data: row, error: null }); },
    };
    for (const m of ['select', 'update', 'insert', 'eq', 'order', 'limit', 'single', 'maybeSingle']) {
      builder[m] = () => builder;
    }
    return builder;
  };
  return { from };
}

function ctx(overrides: Partial<MoneyToolContext> = {}): MoneyToolContext {
  return { supabase: mockSupabase(), userId: 'u1', accountId: null, ...overrides };
}

describe('executeMoneyTool — validation failures (no supabase write)', () => {
  it('buy requires a symbol', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { dollarAmount: 100 }, ctx()));
    expect(r.error).toBe('A valid ticker symbol is required.');
  });

  it('buy requires a dollar amount or share count', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'AAPL' }, ctx()));
    expect(r.error).toBe('Provide a dollar amount (≥ $1) or a share count.');
  });

  it('buy rejects a negative dollar amount', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'AAPL', dollarAmount: -5 }, ctx()));
    expect(r.error).toBe('Provide a dollar amount (≥ $1) or a share count.');
  });

  it('buy rejects a negative dollar amount even when shares are also given', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'AAPL', dollarAmount: -5, shares: 5 }, ctx()));
    expect(r.error).toBe('dollarAmount must be at least $1.');
  });

  it('alert create validates alertType against the closed set', async () => {
    const r = JSON.parse(await executeMoneyTool('previewAlertCreate', { symbol: 'AAPL', alertType: 'above_avg', targetValue: 100 }, ctx()));
    expect(r.error).toContain('price_above, price_below, or percent_change');
  });

  it('DCA create requires an end date', async () => {
    const r = JSON.parse(await executeMoneyTool('previewDcaCreate', { symbol: 'AAPL', amount: 100, frequency: 'weekly' }, ctx()));
    expect(r.error).toContain('endDate is required');
  });

  it('unknown tool returns a structured error', async () => {
    const r = JSON.parse(await executeMoneyTool('previewNope', {}, ctx()));
    expect(r.error).toContain('Unknown tool');
  });
});

describe('executeMoneyTool — preview staging (plan-then-confirm, never execute)', () => {
  it('buy stages a pending action with a preview, no side effect', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'aapl', dollarAmount: 100 }, ctx()));
    expect(r.actionType).toBe('buy_stock');
    expect(r.amountUsd).toBe(100);
    expect(r.confirmToken).toBe('AAPL');
    expect(r.preview).toBe('Buy $100 of AAPL.'); // fmtMoney drops trailing .00
    expect(r.requiresSymbolEcho).toBe(false); // $100 < $500 echo threshold
    expect(r.confirmInstruction).toContain('Reply "confirm"');
    expect(r.confirmInstruction).toContain('Nothing has run yet');
  });

  it('buy ≥ $500 requires the symbol echoed in the confirm token', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'AAPL', dollarAmount: 1000 }, ctx()));
    expect(r.requiresSymbolEcho).toBe(true);
    expect(r.confirmInstruction).toContain('Reply "confirm AAPL"');
  });

  it('sell ALWAYS requires symbol echo (irreversible action)', async () => {
    const r = JSON.parse(await executeMoneyTool('previewSellStock', { symbol: 'nvda', shares: 5 }, ctx()));
    expect(r.actionType).toBe('sell_stock');
    expect(r.requiresSymbolEcho).toBe(true);
    expect(r.confirmToken).toBe('NVDA');
    expect(r.confirmInstruction).toContain('Reply "confirm NVDA"');
  });

  it('basket totals its legs and stages a single pending action', async () => {
    const r = JSON.parse(await executeMoneyTool('previewExecuteBasket', {
      basketName: 'AI Basket',
      stocks: [{ symbol: 'AAPL', dollarAmount: 150 }, { symbol: 'NVDA', dollarAmount: 150 }],
    }, ctx()));
    expect(r.actionType).toBe('basket_execute');
    expect(r.amountUsd).toBe(300);
    expect(r.preview).toContain('2 positions');
    expect(r.preview).toContain('$300 total');
  });

  it('basket rejects a leg with no dollar amount', async () => {
    const r = JSON.parse(await executeMoneyTool('previewExecuteBasket', { stocks: [{ symbol: 'AAPL' }] }, ctx()));
    expect(r.error).toContain('dollar amount ≥ $1');
  });
});

describe('executeMoneyTool — auth gate', () => {
  it('anonymous users cannot stage a pending action', async () => {
    const r = JSON.parse(await executeMoneyTool('previewBuyStock', { symbol: 'AAPL', dollarAmount: 100 }, ctx({ userId: 'anonymous' })));
    expect(r.error).toBe('You need to be signed in to do that.');
  });
});
