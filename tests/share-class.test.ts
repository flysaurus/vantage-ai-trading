import { describe, it, expect } from 'vitest';
import {
  shareClassFamily,
  findShareClassSibling,
  siblingMentionedNear,
  shareClassNote,
  stripConflictingRecommendMarkers,
} from '@/lib/ai/share-class';

describe('shareClassFamily', () => {
  it('maps curated dual-class families to one key', () => {
    expect(shareClassFamily('GOOG')).toBe(shareClassFamily('GOOGL'));
    expect(shareClassFamily('FOX')).toBe(shareClassFamily('FOXA'));
    expect(shareClassFamily('BRK.B')).toBe(shareClassFamily('BRK.A'));
    expect(shareClassFamily('NWS')).toBe(shareClassFamily('NWSA'));
  });
  it('is case/space tolerant', () => {
    expect(shareClassFamily(' googl ')).toBe(shareClassFamily('GOOG'));
  });
  it('returns null for names without a known sibling', () => {
    expect(shareClassFamily('NVDA')).toBeNull();
    expect(shareClassFamily('XOM')).toBeNull();
    expect(shareClassFamily('')).toBeNull();
  });
});

describe('findShareClassSibling', () => {
  const held = ['NVDA', 'GOOGL', 'MSFT'];
  it('finds the held sibling class', () => {
    expect(findShareClassSibling('GOOG', held)).toBe('GOOGL');
  });
  it('does not flag the same ticker as its own sibling', () => {
    expect(findShareClassSibling('GOOGL', held)).toBeNull();
  });
  it('does not flag unrelated holdings', () => {
    expect(findShareClassSibling('AAPL', held)).toBeNull();
    expect(findShareClassSibling('AMZN', held)).toBeNull();
  });
  it('honours candidate order', () => {
    expect(findShareClassSibling('BRK.B', ['BRK.A', 'BRK.B'])).toBe('BRK.A');
  });
});

describe('siblingMentionedNear', () => {
  it('catches the live incident shape: marker beside the prose slip', () => {
    const t =
      'Your top holdings are NVDA ($28.3K), MSFT ($20.7K), AMZN ($18.7K), GOOG ($13.6K). ' +
      '[RECOMMEND:GOOGL:BUY:$500]';
    const idx = t.indexOf('[RECOMMEND:');
    expect(siblingMentionedNear(t, 'GOOGL', idx)).toBe('GOOG');
  });
  it('ignores siblings mentioned far away from the marker', () => {
    const far = 'GOOG is up today. ' + 'x'.repeat(600) + ' [RECOMMEND:GOOGL:BUY:$500]';
    expect(siblingMentionedNear(far, 'GOOGL', far.indexOf('[RECOMMEND:'))).toBeNull();
  });
  it('does not fire for a plain single-class ticker', () => {
    const t = 'NVDA is your largest position. [RECOMMEND:NVDA:BUY:$500]';
    expect(siblingMentionedNear(t, 'NVDA', t.indexOf('[RECOMMEND:'))).toBeNull();
  });
});

describe('shareClassNote', () => {
  it('says the action trades the wrong class when the sibling is held', () => {
    const n = shareClassNote('GOOG', 'GOOGL', true);
    expect(n).toContain('GOOGL');
    expect(n).toContain('different security');
  });
  it('warns without claiming a holding when only prose mentioned it', () => {
    const n = shareClassNote('GOOGL', 'GOOG', false);
    expect(n).toContain('share classes');
    expect(n).not.toContain('you hold');
  });
  it('returns null when there is nothing to say', () => {
    expect(shareClassNote('GOOG', 'GOOG', true)).toBeNull();
    expect(shareClassNote('', 'GOOGL', true)).toBeNull();
  });
});

// ── HARD BLOCK (Em, 2026-09-16) ──────────────────────────────────────────────
// The guard no longer annotates a conflicting marker — it removes it, so the
// trade button cannot render. These tests assert the BUTTON-level outcome by
// running the client's real parser regex over the guarded text.
const CLIENT_MARKER_PATTERN = /\[RECOMMEND:([A-Z]{1,5}(?:\.[A-Z]{1,2})?):(BUY|SELL)(?::(\$?[\d,]+(?:\.\d+)?))?\]/g;
const buttons = (t: string) => [...t.matchAll(CLIENT_MARKER_PATTERN)].length;

describe('stripConflictingRecommendMarkers (hard block)', () => {
  it('strips the incident-shaped marker (prose names the sibling class)', () => {
    const incident =
      'Your biggest positions are NVDA ($28.3K), MSFT ($20.7K) and GOOGL ($13.6K). ' +
      'Add to your Google exposure here.\n\n[RECOMMEND:GOOG:BUY:$500]';
    expect(buttons(incident)).toBe(1); // a button WOULD have rendered
    const { text, stripped } = stripConflictingRecommendMarkers(incident, ['GOOGL', 'GOOG']);
    expect(buttons(text)).toBe(0); // …and now none can
    expect(text).not.toContain('[RECOMMEND:');
    expect(stripped).toEqual([{ symbol: 'GOOG', sibling: 'GOOGL', held: true }]);
    // the prose stands, unharmed
    expect(text).toContain('GOOGL ($13.6K)');
    expect(text).toContain('Add to your Google exposure here.');
  });

  it('blocks on a held sibling even when the prose does not name it', () => {
    const t = 'Adding to the Class C line now.\n\n[RECOMMEND:GOOG:BUY:$500]';
    const { text, stripped } = stripConflictingRecommendMarkers(t, ['GOOGL']);
    expect(buttons(t)).toBe(1);
    expect(buttons(text)).toBe(0);
    expect(stripped[0]).toEqual({ symbol: 'GOOG', sibling: 'GOOGL', held: true });
  });

  it('leaves a marker with no share-class conflict completely untouched', () => {
    const t = 'AVGO looks strong.\n\n[RECOMMEND:AVGO:BUY:$500]';
    const { text, stripped } = stripConflictingRecommendMarkers(t, ['GOOGL', 'NVDA']);
    expect(text).toBe(t);
    expect(stripped).toEqual([]);
    expect(buttons(text)).toBe(1); // legitimate button still renders
  });

  it('strips only the conflicting marker when several are present', () => {
    const t = '[RECOMMEND:AVGO:BUY:$500] and [RECOMMEND:GOOG:BUY:$500] beside GOOGL.';
    const { text, stripped } = stripConflictingRecommendMarkers(t, ['GOOGL']);
    expect(stripped).toHaveLength(1);
    expect(text).toContain('[RECOMMEND:AVGO:BUY:$500]');
    expect(text).not.toContain('[RECOMMEND:GOOG');
    expect(buttons(text)).toBe(1);
  });

  it('leaves clean prose and collapses the whitespace the marker left behind', () => {
    const t = 'Line one.\n\n[RECOMMEND:GOOG:BUY:$500]\n\nLine two names GOOGL.';
    const { text } = stripConflictingRecommendMarkers(t, ['GOOGL']);
    expect(text).toBe('Line one.\n\nLine two names GOOGL.');
    expect(text).not.toMatch(/[ \t]$/m);
    expect(text).not.toMatch(/\n{3,}/);
  });

  it('does nothing without holdings or a marker', () => {
    expect(stripConflictingRecommendMarkers('plain prose', []).text).toBe('plain prose');
    expect(stripConflictingRecommendMarkers('', ['GOOGL']).text).toBe('');
  });

  it('never strips a marker for the class the user holds when the prose is clean', () => {
    const t = 'Adding to the Class A line.\n\n[RECOMMEND:GOOGL:BUY:$500]';
    const { stripped } = stripConflictingRecommendMarkers(t, ['GOOGL', 'AVGO']);
    expect(stripped).toEqual([]);
  });
});

describe('share-class strip also cleans the summary card, the plan block and the confirm prose', () => {
  const D2 =
    '[SUMMARY_TLDR: $1,500 across three positions — $500 AVGO (~1.5 shares), $500 GOOG (~1.5 shares), $500 XOM (~3 shares)]\n\n' +
    '**AVGO** — $500 at $339.27 live = ~1.5 shares [RECOMMEND:AVGO:BUY:$500]\n' +
    '**GOOG** — $500 at $341.43 live = ~1.5 shares [RECOMMEND:GOOG:BUY:$500]\n' +
    '**XOM** — $500 at $169.32 live = ~3 shares [RECOMMEND:XOM:BUY:$500]\n\n' +
    'Reply **"confirm AVGO"** to buy AVGO\nReply **"confirm GOOG"** to buy GOOG\nReply **"confirm XOM"** to buy XOM';
  const held = ['GOOGL', 'NVDA'];

  it('drops the blocked ticker from SUMMARY_TLDR and re-states the count + total', () => {
    const { text } = stripConflictingRecommendMarkers(D2, held);
    const tldr = text.match(/\[SUMMARY_TLDR:[^\]]*\]/)?.[0] ?? '';
    expect(tldr).not.toMatch(/GOOG/);
    expect(tldr).toContain('two positions');
    expect(tldr).toContain('$1,000');
    expect(tldr).toContain('$500 AVGO');
    expect(tldr).toContain('$500 XOM');
  });

  it('leaves the surviving buttons intact while the blocked one is gone', () => {
    const { text } = stripConflictingRecommendMarkers(D2, held);
    expect(buttons(text)).toBe(2);
    expect(text).toContain('[RECOMMEND:AVGO:BUY:$500]');
    expect(text).toContain('[RECOMMEND:XOM:BUY:$500]');
    expect(text).not.toContain('[RECOMMEND:GOOG');
  });

  it('removes the typed-confirm instruction for the blocked ticker only', () => {
    const { text } = stripConflictingRecommendMarkers(D2, held);
    expect(text).not.toContain('"confirm GOOG"');
    expect(text).toContain('"confirm AVGO"');
    expect(text).toContain('"confirm XOM"');
  });

  it('prunes the blocked ticker out of a [PORTFOLIO:{...}] plan and re-totals it', () => {
    const t =
      '[PORTFOLIO:{"strategy":"split","total":1500,"positions":[{"symbol":"AVGO","amount":500},' +
      '{"symbol":"GOOG","amount":500},{"symbol":"XOM","amount":500}]}]\n' +
      '[RECOMMEND:AVGO:BUY:$500] [RECOMMEND:GOOG:BUY:$500] [RECOMMEND:XOM:BUY:$500]';
    const { text } = stripConflictingRecommendMarkers(t, held);
    const json = JSON.parse((text.match(/\[PORTFOLIO:(\{.*\})\]/) as RegExpMatchArray)[1]);
    expect(json.positions.map((p: any) => p.symbol)).toEqual(['AVGO', 'XOM']);
    expect(json.total).toBe(1000);
  });

  it('removes the whole plan block when nothing tradable survives in it', () => {
    const t =
      'prose\n[PORTFOLIO:{"total":500,"positions":[{"symbol":"GOOG","amount":500}]}]\nmore prose';
    const { text } = stripConflictingRecommendMarkers(t + '\n[RECOMMEND:GOOG:BUY:$500]', held);
    expect(text).not.toContain('[PORTFOLIO:');
    expect(text).toContain('prose');
    expect(text).toContain('more prose');
  });

  it('drops a whole sentence that instructs a blocked confirm', () => {
    const t =
      'Setup:\n[RECOMMEND:GOOG:BUY:$500]\nReply **"confirm GOOG"** to execute, or let me know if you meant GOOGL.';
    const { text } = stripConflictingRecommendMarkers(t, held);
    expect(text).not.toContain('confirm GOOG');
    expect(buttons(text)).toBe(0);
  });

  it('leaves prose untouched when nothing is blocked', () => {
    const t = '[SUMMARY_TLDR: $500 into AVGO] [PORTFOLIO:{"total":500,"positions":[]}] [RECOMMEND:AVGO:BUY:$500]';
    expect(stripConflictingRecommendMarkers(t, held).text).toBe(t);
  });
});
