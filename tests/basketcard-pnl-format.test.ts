/**
 * BasketCard PnL formatting — the app's locked-in holdings pattern is
 * `+X% · +$Y` (percentage first, then dollars), and negatives must keep their
 * minus sign. This renders the real component to static markup so the assertion
 * runs against the actual JSX, not a copy of the format string.
 *
 * Written with React.createElement (no JSX) so it runs under the repo's existing
 * vitest config without touching the JSX transform settings.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import BasketCard from '@/components/portfolio/BasketCard';

type Basket = React.ComponentProps<typeof BasketCard>['basket'];

const noop = () => {};

function render(basket: Basket, isExpanded = false) {
  return renderToStaticMarkup(
    React.createElement(BasketCard, {
      basket,
      userId: 'test-user',
      isExpanded,
      isSelected: false,
      selectMode: false,
      onToggleExpand: noop,
      onToggleSelect: noop,
    }),
  );
}

function makeBasket(overrides: Partial<Basket> = {}): Basket {
  return {
    id: 'basket-1',
    name: 'AI Infrastructure',
    emoji: '🤖',
    positions: [],
    totalCost: 10000,
    marketValue: 11000,
    totalPnL: 1234.56,
    totalPnLPct: 5.04,
    dailyPnL: 12.34,
    dailyPnLPct: 0.11,
    activeCount: 2,
    status: 'active',
    ...overrides,
  };
}

const pctThenUsd = /[+-]\d+(\.\d+)?%\s*·\s*[+-]\$[\d,]+\.\d{2}/;
const parenthetical = /\$[\d,]+\.\d{2}\s*\([+-]?[\d.]+%\)/;

describe('BasketCard PnL format', () => {
  it('renders total PnL as +X% · +$Y (percentage first)', () => {
    const html = render(makeBasket());
    expect(html).toContain('+5.0% · +$1,234.56');
    expect(parenthetical.test(html)).toBe(false);
  });

  it('renders the Today line as +X% · +$Y', () => {
    const html = render(makeBasket());
    expect(html).toContain('Today +0.11% · +$12.34');
  });

  it('keeps the minus sign on a losing basket', () => {
    const html = render(
      makeBasket({ totalPnL: -789, totalPnLPct: -3.24, dailyPnL: -5.5, dailyPnLPct: -0.02 }),
    );
    expect(html).toContain('-3.2% · -$789.00');
    expect(html).toContain('Today -0.02% · -$5.50');
    expect(parenthetical.test(html)).toBe(false);
  });

  it('renders per-ticker tiles with a minus sign when the ticker is down', () => {
    const html = render(
      makeBasket({
        positions: [
          {
            symbol: 'NVDA',
            shares: 10,
            avgCost: 100,
            currentPrice: 90,
            allocationPct: 50,
            marketValue: 900,
            totalPnL: -100,
            totalPnLPct: -10,
            dailyPnL: -12.34,
            dailyPnLPct: -1.35,
            status: 'active',
          },
        ],
      }),
      true,
    );
    expect(html).toContain('-$12.34');
    expect(html).toContain('-1.35%');
    expect(html).toContain('-$100.00');
    expect(html).toContain('-10.00%');
  });

  it('keeps the percentage before the dollar amount everywhere in the card', () => {
    const html = render(makeBasket());
    const usdThenPct = /\$[\d,]+\.\d{2}[^<]{0,24}[+-]?\d+(\.\d+)?%/;
    expect(usdThenPct.test(html)).toBe(false);
    expect(pctThenUsd.test(html)).toBe(true);
  });
});
