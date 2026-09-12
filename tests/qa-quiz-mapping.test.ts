// ─── QA: onboarding quiz Q3/Q4 copy + archetype scoring ──────
// Verifies the Q3 letter→archetype mapping matches the new option order,
// that Q4 option C copy changed without moving its archetype, and that the
// new Q3 letters are deliberately NOT in the Q1/Q2/Q4 order.
import { describe, it, expect } from 'vitest';
import { scoreQuiz, QUIZ_QUESTIONS } from '@/lib/onboarding/quiz-logic';

const q = (id: string) => QUIZ_QUESTIONS.find((x) => x.id === id)!;

// control: Q3 answered with an invalid key → contributes no votes
const CONTROL = scoreQuiz(['A', 'A', 'Z', 'A', 'A']);

function deltaForQ3(letter: string) {
  const r = scoreQuiz(['A', 'A', letter, 'A', 'A']);
  const d: Record<string, number> = {};
  const cv = CONTROL.votes as Record<string, number>;
  const rv = r.votes as Record<string, number>;
  for (const k of Object.keys(rv)) d[k] = rv[k] - cv[k];
  return Object.entries(d).filter(([, v]) => v !== 0).map(([k, v]) => `${k}:${v}`).join(',');
}

describe('Q3 option copy', () => {
  it('has the five new option texts', () => {
    expect(q('q3').options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(q('q3').options[0].text).toContain('let the winners run');
    expect(q('q3').options[1].text).toContain("survive my checklist");
    expect(q('q3').options[2].text).toContain('best idea gets the biggest slice');
    expect(q('q3').options[3].text).toContain('odds are heavily skewed');
    expect(q('q3').options[4].text).toContain('start small on all five');
  });
});

describe('Q3 archetype mapping', () => {
  it('A→lynch', () => expect(deltaForQ3('A')).toBe('lynch:1'));
  it('B→munger', () => expect(deltaForQ3('B')).toBe('munger:1'));
  it('C→buffett', () => expect(deltaForQ3('C')).toBe('buffett:1'));
  it('D→soros', () => expect(deltaForQ3('D')).toBe('soros:1'));
  it('E→livermore', () => expect(deltaForQ3('E')).toBe('livermore:1'));

  it('is NOT in the same letter order as Q1', () => {
    // Q1: A→buffett B→livermore C→soros D→munger E→lynch
    expect(deltaForQ3('A')).not.toBe('buffett:1');
    expect(deltaForQ3('B')).not.toBe('livermore:1');
    expect(deltaForQ3('C')).not.toBe('soros:1');
  });
});

describe('Q4 option C copy', () => {
  it('was replaced with the inversion text', () => {
    expect(q('q4').options[2].text).toContain('find a real reason NOT to do it');
    expect(q('q4').options[2].text).toContain("can't kill the idea");
  });
  it('keeps its archetype (C→buffett, unchanged)', () => {
    const r = scoreQuiz(['A', 'A', 'A', 'C', 'A']);
    // Q1 A→buffett, Q2 A→buffett, Q3 A→lynch, Q4 C→buffett
    expect(r.votes.buffett).toBe(3);
    expect(r.votes.lynch).toBe(1);
    expect(r.style).toBe('buffett');
  });
});
