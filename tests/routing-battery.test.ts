// ═══════════════════════════════════════════════════════════════
// tests/routing-battery.test.ts — deterministic routing regression battery
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/routing-battery.test.ts
//
// Locks in the deterministic routing layer (profile → app-help → scheduled
// activity → confirm → execute-rebalance → account-action → classifier). A
// phrasing here either MUST be caught by the right deterministic handler, or
// MUST fall through to the classifier (so a detector never over-matches and
// hijacks a real trade / question).
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { detectProfileQuestion } from '../lib/ai/profile-answers';
import { detectAppHelpIntent } from '../lib/ai/app-help';
import { detectScheduledActivityIntent, detectAccountAction, detectExecuteRebalance } from '../lib/ai/account-actions';
import { detectConfirmIntent } from '../lib/ai/confirm';

type Expected = 'profile' | 'app-help' | 'scheduled_activity' | 'confirm' | 'execute_rebalance' | 'account' | 'classifier';

function route(msg: string): string {
  const pq = detectProfileQuestion(msg);
  if (pq) return 'profile:' + pq;
  const ah = detectAppHelpIntent(msg);
  if (ah) return 'app-help:' + ah;
  if (detectScheduledActivityIntent(msg)) return 'scheduled_activity';
  // In the real route, the confirm gate runs BEFORE execute-rebalance — but it
  // falls through (no return) when there's no pending action, so here we model
  // the no-pending-action case by checking execute-rebalance first.
  if (detectExecuteRebalance(msg)) return 'execute_rebalance';
  const ci = detectConfirmIntent(msg);
  if (ci.type !== 'none') return 'confirm:' + ci.type;
  const aa = detectAccountAction(msg);
  if (aa) return 'account:' + aa.type;
  return '→ CLASSIFIER';
}

function matches(exp: Expected, got: string): boolean {
  if (exp === 'profile') return got.startsWith('profile:');
  if (exp === 'app-help') return got.startsWith('app-help:');
  if (exp === 'scheduled_activity') return got === 'scheduled_activity';
  if (exp === 'confirm') return got.startsWith('confirm:');
  if (exp === 'execute_rebalance') return got === 'execute_rebalance';
  if (exp === 'account') return got.startsWith('account:');
  if (exp === 'classifier') return got === '→ CLASSIFIER';
  return false;
}

const BATTERY: Array<[string, Expected]> = [
  // ── Profile questions (deterministic) ──
  ["what's my investment style", 'profile'],
  ['what is my investor style', 'profile'],
  ['what investor style am i', 'profile'],
  ['what style of investor am i', 'profile'],
  ["what's my risk tolerance", 'profile'],
  ["what's my risk level", 'profile'],
  ['what do you know about me', 'profile'],

  // ── App help (deterministic) ──
  ['help', 'app-help'],
  ['what can you do', 'app-help'],
  ['how do i rebalance', 'app-help'],
  ['how do i set up a dca', 'app-help'],
  ['how do i change my style', 'app-help'],
  ['how do i connect my broker', 'app-help'],
  ['how do i set an alert', 'app-help'],
  ['how do i add funds', 'app-help'],
  ['what is rebalancing', 'app-help'],

  // ── Scheduled activity (deterministic) ──
  ['what are my scheduled buys', 'scheduled_activity'],
  ['any open orders', 'scheduled_activity'],
  ['show me my pending orders', 'scheduled_activity'],
  ['recurring buys', 'scheduled_activity'],
  ['show my dca', 'scheduled_activity'],
  ['what am i waiting to fill', 'scheduled_activity'],
  ["what's queued to execute", 'scheduled_activity'],

  // ── Confirm / cancel (deterministic gate) ──
  ['yes', 'confirm'],
  ['confirm', 'confirm'],
  ['cancel', 'confirm'],
  ['no', 'confirm'],

  // ── Execute rebalance (deterministic) ──
  ['execute the rebalance', 'execute_rebalance'],
  ['place the rebalance trades', 'execute_rebalance'],
  ['run the rebalance now', 'execute_rebalance'],

  // ── Account actions: rebalance (deterministic) ──
  ['rebalance', 'account'],
  ['rebalance my portfolio', 'account'],
  ['rebalance using cash only', 'account'],
  ['rebalance with full portfolio', 'account'],
  ['rebalance with $5000', 'account'],

  // ── Account actions: style change (deterministic) ──
  ['change my style to lynch', 'account'],
  ['switch my investment style to buffett', 'account'],
  ['change my style', 'account'],

  // ── Account actions: risk change (deterministic) ──
  ['change it to aggressive', 'account'],
  ['make me more conservative', 'account'],
  ['set my risk to moderate', 'account'],
  ['change my risk tolerance to high risk', 'account'],

  // ── Must fall through to the classifier / fast-path (NOT deterministic) ──
  ['what should i buy next', 'classifier'],
  ['buy 10 shares of aapl', 'classifier'],
  ['is nvda a good buy right now', 'classifier'],
  ['build me a diversified portfolio', 'classifier'],
  ['how exposed am i to tech', 'classifier'],
  ['what is a p/e ratio', 'classifier'],
  ['aapl vs msft', 'classifier'],
  ['what is happening in the market today', 'classifier'],
  ['how much cash do i have', 'classifier'],
  ['what are my positions', 'classifier'],
];

describe('deterministic routing battery', () => {
  it.each(BATTERY)('routes %s → %s', (msg, exp) => {
    expect(matches(exp, route(msg))).toBe(true);
  });
});
