import { describe, expect, it } from 'vitest';
import { humanizeTriggerContext } from '@/lib/noticed/engine';

/**
 * ROUND 4 — the "+" sheet leak.
 *
 * Root cause: `lib/noticed/event-impact.ts` builds a MACHINE context string
 * (`"NVDA: earnings event — <headline> (Reuters). severity: info.
 * Informational only — no action needed."`) and the engine wrote that straight
 * into `noticed_items.body` whenever AI copy generation was skipped (budget),
 * failed, or the item was re-activated. The Explore ("+") sheet renders
 * `item.body` verbatim, so users saw the machine string.
 *
 * The fix is at GENERATION time (`humanizeTriggerContext`), never at render
 * time. These tests pin that contract.
 */
describe('humanizeTriggerContext', () => {
  it('builds one clean line from title + headline (no machine fields)', () => {
    const line = humanizeTriggerContext({
      key: 'k',
      triggerType: 'event_impact',
      title: 'NVDA — earnings update',
      context: 'NVDA: earnings event — Q3 beat and raised guidance (Reuters). severity: info. Informational only — no action needed.',
      meta: { symbol: 'NVDA', headline: 'Q3 beat and raised guidance', source: 'Reuters', severity: 'info' },
    } as any);
    expect(line).toBe('NVDA — earnings update — Q3 beat and raised guidance');
    expect(line).not.toMatch(/severity:/i);
  });

  it('never emits the machine markers for ANY input', () => {
    const nasty = [
      'severity: info. Informational only — no action needed.',
      'XLF: earnings event — beat (Reuters). severity: review. No action needed unless your original thesis has changed.',
      'severity: info',
      '',
    ];
    for (const ctx of nasty) {
      const line = humanizeTriggerContext({ key: 'k', triggerType: 'event_impact', title: ctx, context: ctx, meta: {} } as any);
      expect(line).not.toMatch(/severity:|informational only|no action needed/i);
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it('reads the structured headline from meta when the title already contains it', () => {
    const line = humanizeTriggerContext({
      key: 'k',
      triggerType: 'event_impact',
      title: 'XLF — dividend update',
      context: 'machine',
      meta: { headline: 'XLF — dividend update' },
    } as any);
    expect(line).toBe('XLF — dividend update');
    expect(line).not.toContain('— XLF — dividend update — XLF');
  });

  it('falls back to the raw context when it is human copy, never when it is machine copy', () => {
    const human = humanizeTriggerContext({
      key: 'k', triggerType: 'idle_cash', title: 'Idle cash', context: 'You have $25,000 sitting idle.', meta: {},
    } as any);
    expect(human).toBe('Idle cash');

    const machine = humanizeTriggerContext({
      key: 'k', triggerType: 'event_impact', title: 'severity: info. Informational only — no action needed.', context: 'x', meta: {},
    } as any);
    expect(machine).toBe('Something changed in your portfolio.');
  });

  it('builds the structured milestone line from meta when the context is machine copy', () => {
    const line = humanizeTriggerContext({
      trigger_type: 'position_milestone', trigger_key: 'MILESTONE_BX_-20', title: 'BX -20%',
      context: 'BX: crossed -20% total return threshold (currently at -23.9%). Position value: $129.07.',
      meta: { symbol: 'BX', threshold: -20, currentPnlPct: -23.9, marketValue: 129.07 },
    } as any);
    expect(line).toBe('BX crossed -20% (now -24%) — worth a look.');
    expect(line).not.toMatch(/position value|total return threshold/i);
  });

  it('builds the structured idle-cash line from meta', () => {
    const line = humanizeTriggerContext({
      trigger_type: 'idle_cash', trigger_key: 'idle_cash', title: '$100,865 cash idle',
      context: '$100,865 in available cash (after open orders) has been idle for 3 consecutive trading days. Investor style: snaptrade.',
      meta: { amount: 100865, daysIdle: 3 },
    } as any);
    expect(line).toBe('$100,865 of cash has been idle for 3 trading days.');
    expect(line).not.toMatch(/available cash|consecutive trading days|investor style/i);
  });

  it('caps the line at 240 characters (one compact row)', () => {
    const line = humanizeTriggerContext({
      key: 'k', triggerType: 'event_impact', title: 'NVDA — update',
      context: 'x', meta: { headline: 'H'.repeat(400) },
    } as any);
    expect(line.length).toBe(240);
  });
});
