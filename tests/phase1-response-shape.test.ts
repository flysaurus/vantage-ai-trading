import { describe, it, expect } from 'vitest';
import { buildUserProfileContext, getLiteracyTierPrompt, type UserProfile } from '@/lib/ai/userProfile';
import { VANTAGE_SYSTEM_PROMPT } from '@/lib/ai-system-prompt';

// ─── Phase 1: Rufus response overhaul — prompt-level contracts ───────────────
// These lock in (a) the response-shape / action-row rules in the system prompt,
// and (b) the three-tier literacy adaptation injected via the user profile.
// They are prompt-level assertions only — no client/rendering behaviour here.

const base: UserProfile = {
  investorStyle: 'Lynch',
  riskTolerance: 'Moderate',
  name: 'M',
};

describe('VANTAGE_SYSTEM_PROMPT — Phase 1 response shape', () => {
  it('leads with the verdict and forbids restating user-supplied numbers', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('RESPONSE SHAPE — LEAD WITH THE VERDICT');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('NEVER RESTATE NUMBERS THE USER ALREADY GAVE');
  });

  it('caps prose, mandates tables for tabular data, and caps bold', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('CAP PROSE BLOCKS AT 2-3 SENTENCES');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('markdown table');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('BOLD IS SCARCE');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('at most 2-3 truly decision-relevant figures');
  });

  it('requires coverage of every named sub-component plus a reconciliation sentence', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('COVER EVERY SUB-COMPONENT THE USER NAMED');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('Never expose exact internal weighting math');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('RECONCILE APPARENT CONTRADICTIONS IN ONE SENTENCE');
  });

  it('documents the three literacy tiers and the tier-never-removes-content rule', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('THREE-TIER LITERACY ADAPTATION');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('TIER NEVER REMOVES CONTENT');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('Plain, clear language is the FLOOR');
  });

  it('documents the conditional action row (trade button + Download plan)', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('ACTION ROW — TRADE BUTTON + DOWNLOAD PLAN');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('no actionable recommendation means no action row');
  });

  it('keeps the existing marker / CLARIFY / never-say contracts intact', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('[CLARIFY:{');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('[RECOMMEND:');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('RESPONSE LENGTH:');
  });

  // ── Anti-fabrication guard (added after the sub-score audit) ──
  // A structured table signals "verified data" to the reader. The prompt must
  // therefore forbid inventing figures AND forbidding inventing metrics/columns —
  // specifically the portfolio-health case, which has exactly three sub-scores.
  it('forbids invented figures, invented metrics, and invented table columns', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('NEVER INVENT A FIGURE OR A METRIC');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('EXACTLY THREE computed sub-scores — Diversification, Risk balance, Returns');
    expect(VANTAGE_SYSTEM_PROMPT).toMatch(/no "cost", "momentum", "concentration"/);
    expect(VANTAGE_SYSTEM_PROMPT).toContain('never build a "Target" column');
    expect(VANTAGE_SYSTEM_PROMPT).toContain('a fabricated table is worse than plain prose');
  });

  it('narrows the tables rule to context-supplied columns only', () => {
    expect(VANTAGE_SYSTEM_PROMPT).toContain('Only render columns whose values your context actually supplies');
  });
});

describe('getLiteracyTierPrompt — three tiers', () => {
  it('maps the stored values to distinct scaffolding rules', () => {
    const nw = getLiteracyTierPrompt('new');
    const some = getLiteracyTierPrompt('some');
    const exp = getLiteracyTierPrompt('experienced');

    expect(nw).toContain('New to investing');
    expect(nw).toContain('one-clause plain-language explanation');
    expect(nw).toContain('leverage');

    expect(some).toContain('Some experience');
    expect(some).toContain('no inline definitions');
    expect(some).not.toContain('one-clause plain-language explanation');

    expect(exp).toContain('Experienced');
    expect(exp).toContain('target-range column');
    expect(exp).not.toContain('one-clause plain-language explanation');

    // Every tier keeps the completeness mandate.
    for (const t of [nw, some, exp]) {
      expect(t).toMatch(/MANDATORY|mandatory/);
    }
  });

  it('falls back to neutral wording when the question was skipped', () => {
    for (const v of [null, undefined, '', 'nonsense']) {
      const out = getLiteracyTierPrompt(v as string | null | undefined);
      expect(out).toContain('not provided');
      expect(out).toContain('no inline definitions');
    }
  });
});

describe('buildUserProfileContext — tier injection', () => {
  it('injects the tier block for every tier value', () => {
    for (const [tier, needle] of [
      ['new', 'New to investing'],
      ['some', 'Some experience'],
      ['experienced', 'Experienced'],
    ] as const) {
      const ctx = buildUserProfileContext({ ...base, investmentExperience: tier });
      expect(ctx).toContain('USER INVESTMENT EXPERIENCE:');
      expect(ctx).toContain(needle);
      // Existing profile contract is untouched.
      expect(ctx).toContain('Investor Style: Lynch');
      expect(ctx).toContain('Risk Tolerance: Moderate');
    }
  });

  it('still injects the block (neutral) when the field is absent', () => {
    const ctx = buildUserProfileContext(base);
    expect(ctx).toContain('USER INVESTMENT EXPERIENCE:');
    expect(ctx).toContain('not provided');
  });
});
