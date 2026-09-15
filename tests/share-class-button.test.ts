import { describe, it, expect } from 'vitest';
// THE REAL CLIENT PARSER — the exact function AITab uses to turn markers into
// InlineTradeButton rows. If it returns nothing, no trade button can render.
import { parseSuggestions } from '@/components/ai/InlineTradeButton';
import { stripConflictingRecommendMarkers } from '@/lib/ai/share-class';

const INCIDENT =
  'Your biggest positions are NVDA ($28.3K), MSFT ($20.7K) and GOOGL ($13.6K). ' +
  'Adding to your Google exposure here:\n\n[RECOMMEND:GOOG:BUY:$500]';

describe('hard block → client parser produces NO trade button', () => {
  it('control: the incident text WOULD render one button (risk is real)', () => {
    expect(parseSuggestions(INCIDENT, null)).toHaveLength(1);
    expect(parseSuggestions(INCIDENT, null)[0].symbol).toBe('GOOG');
  });

  it('blocked: the guarded text renders ZERO buttons; prose is untouched', () => {
    const { text, stripped } = stripConflictingRecommendMarkers(INCIDENT, ['GOOGL', 'GOOG']);
    expect(stripped[0]).toMatchObject({ symbol: 'GOOG', sibling: 'GOOGL', held: true });
    expect(parseSuggestions(text, null)).toHaveLength(0);
    // the prose still stands, so the answer stays readable
    expect(text).toContain('GOOGL ($13.6K)');
    expect(text).toContain('Adding to your Google exposure here:');
  });

  it('a legitimate marker in the same response still renders its button', () => {
    const mixed = '[RECOMMEND:AVGO:BUY:$500] beside GOOGL, and [RECOMMEND:GOOG:BUY:$500] too.';
    const { text } = stripConflictingRecommendMarkers(mixed, ['GOOGL']);
    const recs = parseSuggestions(text, null);
    expect(recs).toHaveLength(1);
    expect(recs[0].symbol).toBe('AVGO');
  });
});
