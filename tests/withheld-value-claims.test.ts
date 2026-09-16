// ═══════════════════════════════════════════════════════════════
// tests/withheld-value-claims.test.ts — prose states a withheld value as fact
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/withheld-value-claims.test.ts
//
// Guards the class found live on prod 2026-09-16: the P&L bridge chart declares
// the start UNKNOWN while the prose above it printed "Opening Position
// ~$97,580" — the aggregate cost basis (Total Value − Total P&L), a figure the
// model genuinely had, relabeled as the account's starting capital.
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  detectWithheldValueClaim,
  detectUnknownStartClaim,
  suppressWithheldValueClaims,
  suppressUnknownStartClaims,
  WITHHELD_VALUE_CLAIMS,
} from '../lib/ai/response-guards';

const MARKER = '[CHART:waterfall|pnl-waterfall]';

// The verbatim shape captured off prod (deploy #15).
const INCIDENT = `Your P&L bridge — all the way from initial capital to today:

| Stage | Amount |
|-------|--------|
| **Opening Position** | ~$97,580 |
| **Unrealised Gains/Losses** | **+$2,178** |
| **Today's Change** | **+$593** |
| **Current Value** | **$99,758** |
| **Cash** | $469 |
| **Total Account** | **$100,227** |

**The story:** You're up $2,178 total (2.1%) from your entry prices.

${MARKER}`;

describe('detectWithheldValueClaim', () => {
  it('fires on the exact prod incident (label + figure, chart marker present)', () => {
    const hit = detectWithheldValueClaim(INCIDENT)!;
    expect(hit.id).toBe('unknown_start');
    expect(hit.match.toLowerCase()).toContain('opening');
  });

  it('detectUnknownStartClaim returns the offending label', () => {
    expect(detectUnknownStartClaim(INCIDENT)).toMatch(/opening position/i);
  });

  it('does NOT fire without a chart marker (class is chart/prose mismatch)', () => {
    const noMarker = INCIDENT.replace(MARKER, '').trim();
    expect(detectWithheldValueClaim(noMarker)).toBeNull();
  });

  it('does NOT fire on a label with no currency figure on the line', () => {
    const t = `The opening position is unknown for this account.\n\n${MARKER}`;
    expect(detectWithheldValueClaim(t)).toBeNull();
  });

  it('does NOT fire on an unrelated table that has figures', () => {
    const t = `| Sector | Weight |\n|---|---|\n| Tech | 32% |\n| Energy | $12,400 |\n\n${MARKER}`;
    expect(detectWithheldValueClaim(t)).toBeNull();
  });

  it('is table-driven — every registered claim carries a note and an id', () => {
    for (const c of WITHHELD_VALUE_CLAIMS) {
      expect(c.id).toBeTruthy();
      expect(c.note.length).toBeGreaterThan(20);
    }
  });
});

describe('suppressWithheldValueClaims', () => {
  it('drops the fabricated row + its figure, keeps every other row', () => {
    const { text, removed, ids } = suppressWithheldValueClaims(INCIDENT);
    expect(removed).toBe(1);
    expect(ids).toEqual(['unknown_start']);
    expect(text).not.toContain('97,580');
    expect(text).not.toMatch(/opening position/i);
    // Real figures survive untouched.
    expect(text).toContain('$99,758');
    expect(text).toContain('$100,227');
    expect(text).toContain('+$2,178');
    // Honest replacement note is present.
    expect(text).toMatch(/Starting value: \*\*unknown\*\*/);
  });

  it('inserts the note BEFORE trailing marker-only lines', () => {
    const { text } = suppressWithheldValueClaims(INCIDENT);
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines[lines.length - 1]).toBe(MARKER);
    expect(lines[lines.length - 2]).toMatch(/Starting value: \*\*unknown\*\*/);
  });

  it('drops the prose sentence carrying the claim, keeping sibling sentences', () => {
    const t = `Your opening position was about $97,580. You're up 2.1% on cost. Cash is $469.\n\n${MARKER}`;
    const { text, removed } = suppressWithheldValueClaims(t);
    expect(removed).toBe(1);
    expect(text).not.toContain('97,580');
    expect(text).toContain("You're up 2.1% on cost.");
    expect(text).toContain('Cash is $469.');
  });

  it('dedupes the note when several rows are removed', () => {
    const t = `| Stage | Amount |\n|---|---|\n| Opening Position | $97,580 |\n| Initial Capital | $97,580 |\n| Cash | $469 |\n\n${MARKER}`;
    const { text, removed } = suppressWithheldValueClaims(t);
    expect(removed).toBe(2);
    expect((text.match(/Starting value: \*\*unknown\*\*/g) || []).length).toBe(1);
    expect(text).toContain('| Cash | $469 |');
  });

  it('leaves a legitimate cost-basis table completely alone', () => {
    const t = `| Lot | Cost Basis | Value |\n|---|---|---|\n| AAPL | $4,120 | $5,010 |\n\n${MARKER}`;
    const { text, removed } = suppressWithheldValueClaims(t);
    expect(removed).toBe(0);
    expect(text).toBe(t);
  });

  it('is a no-op when the response ships no chart marker', () => {
    const t = 'Your opening position was about $97,580, so you are up 2%.';
    const { text, removed } = suppressWithheldValueClaims(t);
    expect(removed).toBe(0);
    expect(text).toBe(t);
  });

  it('is a no-op on ordinary chart prose', () => {
    const t = `Tech is 32% of the book, with $12,400 in energy exposure.\n\n${MARKER}`;
    expect(suppressWithheldValueClaims(t).removed).toBe(0);
  });

  it('suppressUnknownStartClaims touches only the unknown_start claim', () => {
    const r = suppressUnknownStartClaims(INCIDENT);
    expect(r.removed).toBe(1);
    expect(r.ids).toEqual(['unknown_start']);
  });

  it('handles empty input safely', () => {
    expect(suppressWithheldValueClaims('')).toEqual({ text: '', removed: 0, ids: [] });
    expect(detectWithheldValueClaim('')).toBeNull();
  });
});
