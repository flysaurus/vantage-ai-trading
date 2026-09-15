import { describe, it, expect } from 'vitest';
import {
  shareClassFamily,
  findShareClassSibling,
  siblingMentionedNear,
  shareClassNote,
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
