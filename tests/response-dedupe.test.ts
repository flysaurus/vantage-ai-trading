import { describe, it, expect } from 'vitest';
import { stripDuplicateBreakdownProse } from '@/lib/ai/response-dedupe';

// A realistic "recession-proof portfolio" shape: prose breakdown at the top,
// then the [POSITION:] markers that render as the boxed cards at the bottom.
const RESPONSE = `Here is a recession-proof portfolio for you.

**Asset allocation**
- 40% VOO — broad US large-cap core
- 25% BND — aggregate bonds
- 20% SCHD — dividend quality
- 15% GLD — gold ballast

[POSITION:VOO:40:Vanguard S&P 500 ETF]
[POSITION:BND:25:Vanguard Total Bond Market ETF]
[POSITION:SCHD:20:Schwab US Dividend Equity ETF]
[POSITION:GLD:15:SPDR Gold Shares]

This mix leans defensive while keeping long-run equity exposure.`;

describe('stripDuplicateBreakdownProse', () => {
  it('removes the inline breakdown list and the now-empty heading', () => {
    const { text, removed } = stripDuplicateBreakdownProse(RESPONSE);
    expect(removed).toBeGreaterThanOrEqual(4);
    expect(text).not.toMatch(/40% VOO/);
    expect(text).not.toMatch(/25% BND/);
    // Marker lines survive untouched.
    expect(text).toContain('[POSITION:VOO:40:Vanguard S&P 500 ETF]');
    // Prose survives.
    expect(text).toContain('Here is a recession-proof portfolio for you.');
    expect(text).toContain('This mix leans defensive');
  });

  it('drops a heading left empty when its whole section was duplicate', () => {
    const input = `Intro.

**Asset allocation**
- 40% VOO — core
- 15% VOO — top-up

[POSITION:VOO:40:Vanguard S&P 500 ETF]`;
    const { text } = stripDuplicateBreakdownProse(input);
    expect(text).not.toMatch(/\*\*Asset allocation\*\*/);
    expect(text).not.toMatch(/40% VOO/);
  });

  it('is a no-op when there are no position markers', () => {
    const plain = 'VOO is 40% of your book and BND is 25%.';
    expect(stripDuplicateBreakdownProse(plain)).toEqual({ text: plain, removed: 0 });
  });

  it('keeps prose bullets that do not duplicate a card ticker', () => {
    const withOther = `Intro line.

- 30% QQQ — growth sleeve

[POSITION:VOO:40:Vanguard S&P 500 ETF]

Outro.`;
    const { text, removed } = stripDuplicateBreakdownProse(withOther);
    expect(removed).toBe(0);
    expect(text).toBe(withOther.trim());
    expect(text).toContain('30% QQQ');
  });

  it('drops duplicated table rows too', () => {
    const table = `| Ticker | Weight |
| --- | --- |
| VOO | 40% |
| BND | 25% |

[POSITION:VOO:40:Vanguard S&P 500 ETF]
[POSITION:BND:25:Vanguard Total Bond Market ETF]`;
    const { text } = stripDuplicateBreakdownProse(table);
    expect(text).not.toMatch(/\| VOO \| 40% \|/);
    expect(text).toContain('[POSITION:VOO:40:Vanguard S&P 500 ETF]');
  });

  it('never removes a marker line even if it looks like a list item', () => {
    const markerLine = '- [POSITION:VOO:40:Vanguard S&P 500 ETF]';
    const input = `Intro.\n${markerLine}\n40% VOO in prose.\n[POSITION:VOO:40:Vanguard S&P 500 ETF]`;
    const { text } = stripDuplicateBreakdownProse(input);
    expect(text).toContain(markerLine);
  });
});
