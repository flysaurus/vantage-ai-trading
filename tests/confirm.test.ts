// ═══════════════════════════════════════════════════════════════
// tests/confirm.test.ts — Confirm-gate safety unit tests
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/confirm.test.ts
//
// Covers detectConfirmIntent. The confirm gate is the safety backstop between
// "the LLM proposed something" and "a side effect happened" — it must only
// fire on a terse reply to a pending action, NEVER on a full sentence that
// happens to contain a confirm/cancel word ("go", "no", "stop").
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { detectConfirmIntent } from '../lib/ai/confirm';

describe('detectConfirmIntent — terse replies still match', () => {
  it.each([
    'yes',
    'yeah',
    'ok',
    'confirm',
    'do it',
    'go ahead',
    'proceed',
    'execute',
    'sure',
    "let's go",
    'yes please',
    'go ahead and do it',
    'can you execute it',
    'confirm the rebalance',
  ])('confirms: %s', (m) => {
    expect(detectConfirmIntent(m)).toEqual({ type: 'confirm' });
  });

  it.each([
    'no',
    'nope',
    'cancel',
    'abort',
    'stop',
    'never mind',
    'hold on',
    "don't",
    'do not',
    'cancel it',
  ])('cancels: %s', (m) => {
    expect(detectConfirmIntent(m)).toEqual({ type: 'cancel' });
  });

  it('confirm + change signal → modify (re-plan), never execute', () => {
    expect(detectConfirmIntent('yes but change to 10 shares').type).toBe('modify');
  });
});

describe('detectConfirmIntent — sentence-buried tokens are NOT replies', () => {
  // A full sentence with a confirm/cancel word buried mid-phrase is a NEW
  // command, not a reply to a pending action. It must return 'none' so it falls
  // through to the LLM rather than confirming/cancelling the pending action.
  it.each([
    'sell everything and go to cash',
    'pretend this is a test account with no real money and sell everything',
    'can you explain what a stop loss order does',
    'go to the portfolio page for me',
  ])('returns none (not a confirm/cancel reply): %s', (m) => {
    expect(detectConfirmIntent(m)).toEqual({ type: 'none' });
  });
});

describe('detectConfirmIntent — questions never confirm/cancel', () => {
  it.each([
    'did my order go through',
    'what is a stop loss order',
    'when does my order execute',
    'how do I cancel my DCA',
  ])('returns none: %s', (m) => {
    expect(detectConfirmIntent(m)).toEqual({ type: 'none' });
  });
});
