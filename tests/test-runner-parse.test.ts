// ─── Test Runner: bulk-paste parser ───────────────────────────
// Pure, no network, no Supabase. Run with:
//   npx vitest run tests/test-runner-parse.test.ts

import { describe, it, expect } from 'vitest';
import { parseTestCasePaste } from '@/lib/qa/test-runner';

describe('parseTestCasePaste — happy path', () => {
  it('parses a single full block', () => {
    const text = `TC-014: Login with a valid email
Steps:
1. Open /login
2. Enter credentials
Expected: User lands on the dashboard
Area: Auth`;

    const { cases, skipped } = parseTestCasePaste(text);
    expect(skipped).toEqual([]);
    expect(cases).toHaveLength(1);
    expect(cases[0]).toEqual({
      tc_number: 'TC-014',
      title: 'Login with a valid email',
      steps: '1. Open /login\n2. Enter credentials',
      expected_result: 'User lands on the dashboard',
      area: 'Auth',
    });
  });

  it('accepts "Expected Result:" as an alias for "Expected:"', () => {
    const { cases } = parseTestCasePaste(
      `TC-020: Alias check\nExpected Result: It works`,
    );
    expect(cases[0].expected_result).toBe('It works');
  });
});

describe('parseTestCasePaste — multiple blocks', () => {
  it('splits blocks on blank lines', () => {
    const text = `TC-001: First
Steps:
step a

TC-002: Second
Expected: two

TC-003: Third`;
    const { cases } = parseTestCasePaste(text);
    expect(cases.map((c) => c.tc_number)).toEqual(['TC-001', 'TC-002', 'TC-003']);
    expect(cases[0].steps).toBe('step a');
    expect(cases[1].expected_result).toBe('two');
    expect(cases[2].title).toBe('Third');
  });
});

describe('parseTestCasePaste — missing optional sections', () => {
  it('handles a title-only block', () => {
    const { cases } = parseTestCasePaste('TC-010: Just a title');
    expect(cases[0]).toEqual({
      tc_number: 'TC-010',
      title: 'Just a title',
      steps: null,
      expected_result: null,
      area: null,
    });
  });

  it('accepts a bare TC number with no title', () => {
    const { cases } = parseTestCasePaste('TC-099');
    expect(cases[0].tc_number).toBe('TC-099');
    expect(cases[0].title).toBe('');
  });

  it('keeps steps but leaves expected null when only Steps is present', () => {
    const { cases } = parseTestCasePaste('TC-011: Partial\nSteps:\ndo the thing');
    expect(cases[0].steps).toBe('do the thing');
    expect(cases[0].expected_result).toBeNull();
    expect(cases[0].area).toBeNull();
  });
});

describe('parseTestCasePaste — whitespace tolerance', () => {
  it('survives extra blank lines, tabs and ragged spacing', () => {
    const text = `TC-005:   Spaced   out title
\tSteps:\n\t\tline one
        line two


      TC-006:\tTabbed title
Area:    UI   `;

    const { cases } = parseTestCasePaste(text);
    expect(cases).toHaveLength(2);
    expect(cases[0].tc_number).toBe('TC-005');
    expect(cases[0].title).toBe('Spaced   out title');
    expect(cases[0].steps).toBe('line one\nline two');
    expect(cases[1].tc_number).toBe('TC-006');
    expect(cases[1].title).toBe('Tabbed title');
    expect(cases[1].area).toBe('UI');
  });

  it('normalises a lowercase tc number to upper case', () => {
    const { cases } = parseTestCasePaste('tc-14: lower');
    expect(cases[0].tc_number).toBe('TC-14');
  });

  it('accepts "-" and "." as the title separator', () => {
    const a = parseTestCasePaste('TC-100 - dash title').cases[0];
    const b = parseTestCasePaste('TC-101. dot title').cases[0];
    expect(a.title).toBe('dash title');
    expect(b.title).toBe('dot title');
  });
});

describe('parseTestCasePaste — a case with no steps', () => {
  it('records null steps and warns nothing', () => {
    const { cases } = parseTestCasePaste('TC-030: No steps here\nExpected: nothing breaks\nArea: Misc');
    expect(cases[0].steps).toBeNull();
    expect(cases[0].expected_result).toBe('nothing breaks');
    expect(cases[0].area).toBe('Misc');
  });
});

describe('parseTestCasePaste — malformed input', () => {
  it('collects blocks that do not start with a TC number as skipped', () => {
    const text = `Just some free text
with more lines

TC-040: Valid case`;
    const { cases, skipped } = parseTestCasePaste(text);
    expect(cases.map((c) => c.tc_number)).toEqual(['TC-040']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toBe('Just some free text');
  });

  it('returns empty results for blank input', () => {
    expect(parseTestCasePaste('')).toEqual({ cases: [], skipped: [] });
    expect(parseTestCasePaste('   \n\n  ')).toEqual({ cases: [], skipped: [] });
  });
});
