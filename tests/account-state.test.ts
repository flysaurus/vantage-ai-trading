import { describe, it, expect } from 'vitest';
import { detectAccountStateIntent } from '../lib/ai/account-actions';

// The full account_state slice of the 366-entry intent dataset.
// "hw much have i made on my 401k" is a returns/P&L question, not a balance
// question — buildAccountStateAnswer shows equity/cash/positions, so returning
// it there would be wrong. Intentionally NOT detected.
const ACCOUNT_STATE = [
  'how much cash do i have',
  'whats my account balance',
  'how much buying power do i have',
  'whats my total portfolio value',
  'how much money is in my account',
  'whats my available cash',
  'how much is reserved right now',
  'whats my net worth in here',
  'how much have i invested total',
  'whats my current equity',
  'how much cash do i have left',
  'whats my total account value',
  'how much money do i have to invest',
  'whats my buying power right now',
  'how much is my portfolio worth',
  'whats my total invested amount',
  'how much cash is available',
  'whats my current balance',
  'how much do i have in reserved funds',
  'whats my portfolio worth today',
  'how am i doing overall',
  'what do i own',
  'how much do i have',
  'whats my total account value right now',
  'how much money do i have total',
  'whats sitting in my account',
  'how much have i got to spend',
  'whats my current cash position',
  'how much is my account worth',
  'whats my overall balance look like',
  'how much am i worth in this account',
  'whats my spending power right now',
  'how am i doing',
  'hows my account looking',
  'whats going on with my money',
  'how much am i working with',
  'whats my situation right now',
  'how much have i got in here',
  'whats the total damage looking like',
  'hw much cash i got left fr',
  'hw much buyin power i got',
];

describe('detectAccountStateIntent — recall', () => {
  it.each(ACCOUNT_STATE)('detects account-state query: %s', (q) => {
    expect(detectAccountStateIntent(q)).toBe(true);
  });
});

describe('detectAccountStateIntent — non-account queries must NOT match', () => {
  const nonAccount = [
    // Company fundamentals (research, not my account).
    "tell me about apple's balance sheet",
    "whats meta's debt situation",
    // Trade / research about a specific security.
    'buy $100 worth of voo',
    'how much cash should i invest in nvda',
    'how much do i have in nvda',
    'how much do i have in apple',
    'should i buy more amd',
    'is nvda a buy right now',
    'is meta worth buying now',
    'is snowflake worth the risk',
    // Single-security / portfolio-relative questions.
    'how is my apple position doing',
    'how are my basket positions doing overall',
    'which of my stocks is losing money',
    'what should i be buying right now',
    // Educational / market / scheduled.
    'what is a mutual fund',
    'whats an index fund',
    'whats a margin account',
    'whats the market doing today',
    'how is the s&p 500 doing overall',
    'when does my money move next',
    'whats still pending in my account',
  ];

  it.each(nonAccount)('does NOT detect: %s', (q) => {
    expect(detectAccountStateIntent(q)).toBe(false);
  });

  it('does not treat "how much have i made on my 401k" as a balance query', () => {
    expect(detectAccountStateIntent('hw much have i made on my 401k')).toBe(false);
  });
});
