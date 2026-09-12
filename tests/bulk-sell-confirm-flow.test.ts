/**
 * BulkSellSheet — the bulk-sell confirm-flow safety contract.
 *
 * `components/portfolio/BulkSellSheet.tsx` is the ONE place in Vantage where a
 * single tap could liquidate an entire account. Holdings' "Select → Sell
 * Selected" routes through this sheet precisely so that never happens silently:
 * it lists what is being sold, discloses the FIFO lots that will be consumed,
 * and requires an explicit "Sell N" confirm tap before `onConfirm` runs.
 *
 * Today nothing in `tests/` locks that behaviour — delete the confirm step and
 * every suite still passes. These tests exist to make that impossible.
 *
 * Conventions (matches tests/basketcard-pnl-format.test.ts):
 *   • vitest, environment 'node' — no jsdom, no @testing-library.
 *   • `renderToStaticMarkup` from react-dom/server with React.createElement
 *     (no JSX), so assertions run against the REAL component's JSX.
 *   • The component's `useEffect` lot fetch cannot run under static markup, so
 *     the FIFO block renders in its loading state. We only assert on what is
 *     deterministic at render time. Lot/FIFO *logic* is covered by the
 *     dedicated fifo-engine suite; here we lock the confirm gate itself.
 *   • Which props a component attaches can't be read from an HTML string, so
 *     for behavioural assertions we capture the real element tree by invoking
 *     the component inside a Probe render (hooks get a real dispatcher, so
 *     usePageScrollLock / useState / useMemo resolve normally). Every prop
 *     asserted below is the actual one the component wired up.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BulkSellSheet from '@/components/portfolio/BulkSellSheet';

type SheetProps = React.ComponentProps<typeof BulkSellSheet>;
type El = React.ReactElement<any>;

const noop = () => {};

function renderSheet(props: SheetProps): string {
  return renderToStaticMarkup(React.createElement(BulkSellSheet, props));
}

// ── Element-tree capture (public APIs only; no second React copy) ──────────
let captured: El | null = null;
function Probe({ sheetProps }: { sheetProps: SheetProps }) {
  // Called inside a real render so the component's hooks have a dispatcher.
  captured = BulkSellSheet(sheetProps) as unknown as El;
  return captured;
}
function captureTree(props: SheetProps): El {
  captured = null;
  renderToStaticMarkup(React.createElement(Probe, { sheetProps: props }));
  if (!captured) throw new Error('BulkSellSheet rendered nothing');
  return captured;
}

function findAll(node: unknown, pred: (el: El) => boolean, out: El[] = []): El[] {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, pred, out);
    return out;
  }
  const el = node as El;
  if (el.props) {
    if (pred(el)) out.push(el);
    findAll(el.props.children, pred, out);
  }
  return out;
}

const byTestId = (id: string) => (el: El) => el.props['data-testid'] === id;

function findOne(tree: El, id: string): El | null {
  return findAll(tree, byTestId(id))[0] ?? null;
}

/** Concatenated text of an element subtree (labels live in string children). */
function textOf(node: unknown): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const el = node as El;
  return el.props ? textOf(el.props.children) : '';
}

function clickableEls(tree: El): El[] {
  return findAll(tree, (el) => typeof el.props?.onClick === 'function');
}

// ── Fixtures ───────────────────────────────────────────────────────────────
const oneItem: SheetProps['items'] = [{ symbol: 'AAPL', qty: 2, price: 100 }];
const twoItems: SheetProps['items'] = [
  { symbol: 'AAPL', qty: 2, price: 100 },
  { symbol: 'MSFT', qty: 3, price: 50 },
];
const oneBasket: SheetProps['baskets'] = [{ id: 'basket-7', name: 'AI Infra', symbols: ['AAPL', 'NVDA'] }];

function sheetProps(over: Partial<SheetProps> = {}): SheetProps {
  return { items: twoItems, baskets: [], onClose: noop, onConfirm: noop, ...over };
}

describe('BulkSellSheet bulk-sell confirm flow', () => {
  // 1 ── the confirm gate exists and is explicit ──────────────────────────
  it('renders the confirm control, labelled with the number of positions being sold', () => {
    const html = renderSheet(sheetProps());
    expect(html).toContain('bulk-sell-confirm');

    const tree = captureTree(sheetProps());
    const confirm = findOne(tree, 'bulk-sell-confirm');
    expect(confirm).not.toBeNull();
    expect(textOf(confirm)).toContain('Sell 2');

    // The header states the intent explicitly too ("Sell 2 positions").
    const title = findOne(tree, 'bulk-sell-title');
    expect(title).not.toBeNull();
    expect(textOf(title)).toBe('Sell 2 positions');
  });

  it('labels one position singular and two positions plural (count boundary)', () => {
    const one = captureTree(sheetProps({ items: oneItem }));
    expect(textOf(findOne(one, 'bulk-sell-confirm')!)).toBe('Sell 1');
    expect(textOf(findOne(one, 'bulk-sell-title')!)).toBe('Sell 1 position');

    const two = captureTree(sheetProps({ items: twoItems }));
    expect(textOf(findOne(two, 'bulk-sell-confirm')!)).toBe('Sell 2');
    expect(textOf(findOne(two, 'bulk-sell-title')!)).toBe('Sell 2 positions');
  });

  // 2 ── nothing fires without the tap ────────────────────────────────────
  it('does NOT auto-submit on mount (onConfirm untouched by rendering)', () => {
    const onConfirm = vi.fn();
    renderSheet(sheetProps({ onConfirm }));
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // ...and the same holds when the tree is captured for behaviour probing.
    captureTree(sheetProps({ onConfirm }));
    expect(onConfirm).toHaveBeenCalledTimes(0);
  });

  // 3 ── every position being sold is disclosed ──────────────────────────
  it('discloses one row per position, each carrying the symbol and share count', () => {
    const html = renderSheet(sheetProps());
    expect(html).toContain('bulk-sell-item-AAPL');
    expect(html).toContain('bulk-sell-item-MSFT');
    expect(html.match(/data-testid="bulk-sell-item-/g)?.length ?? 0).toBe(2);

    const tree = captureTree(sheetProps());
    const aapl = findOne(tree, 'bulk-sell-item-AAPL');
    const msft = findOne(tree, 'bulk-sell-item-MSFT');
    expect(aapl).not.toBeNull();
    expect(msft).not.toBeNull();
    expect(textOf(aapl)).toContain('AAPL');
    expect(textOf(aapl)).toContain('2 sh');
    expect(textOf(msft)).toContain('MSFT');
    expect(textOf(msft)).toContain('3 sh');
  });

  // 4 ── the total is shown ──────────────────────────────────────────────
  it('shows the summed estimated proceeds, comma-formatted as $X,XXX.XX', () => {
    const items: SheetProps['items'] = [
      { symbol: 'AAPL', qty: 10, price: 1234.56 }, // 12,345.60
      { symbol: 'MSFT', qty: 2, price: 100 }, //        200.00
    ];
    const tree = captureTree(sheetProps({ items }));
    const total = findOne(tree, 'bulk-sell-total');
    expect(total).not.toBeNull();
    expect(textOf(total)).toBe('$12,545.60');
    expect(renderSheet(sheetProps({ items }))).toContain('$12,545.60');
  });

  // 5 ── the escape hatch exists and closes ──────────────────────────────
  it('offers a cancel escape hatch wired to onClose', () => {
    const onClose = vi.fn();
    const tree = captureTree(sheetProps({ onClose }));
    const cancel = findOne(tree, 'bulk-sell-cancel');
    expect(cancel).not.toBeNull();
    expect(cancel!.type).toBe('button');
    expect(typeof cancel!.props.onClick).toBe('function');

    cancel!.props.onClick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 6 ── baskets are disclosed too ───────────────────────────────────────
  it('discloses selected baskets by id and counts them in the confirm label', () => {
    const html = renderSheet(sheetProps({ baskets: oneBasket }));
    expect(html).toContain('bulk-sell-basket-basket-7');

    const tree = captureTree(sheetProps({ baskets: oneBasket }));
    const basket = findOne(tree, 'bulk-sell-basket-basket-7');
    expect(basket).not.toBeNull();
    expect(textOf(basket)).toContain('AI Infra');

    // "+ N baskets" is appended to the confirm label when baskets are selected.
    const confirm = findOne(tree, 'bulk-sell-confirm');
    expect(textOf(confirm)).toContain('Sell 2');
    expect(textOf(confirm)).toContain('+ 1 basket');
  });

  // 7 ── regression-locking guard ────────────────────────────────────────
  it('the confirm tap is a distinct control and the ONLY path that submits', async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const tree = captureTree(sheetProps({ onClose, onConfirm }));

    const confirm = findOne(tree, 'bulk-sell-confirm');
    const cancel = findOne(tree, 'bulk-sell-cancel');
    const overlay = findOne(tree, 'bulk-sell-sheet');

    // Fails outright if the confirm step (its testid/control) is removed.
    expect(confirm).not.toBeNull();
    expect(confirm!.type).toBe('button'); // a real button...
    expect(cancel!.type).toBe('button');
    expect(confirm).not.toBe(cancel); // ...separate from the cancel control
    expect(confirm!.props.onClick).not.toBe(cancel!.props.onClick);
    expect(confirm!.props.onClick).not.toBe(overlay!.props.onClick);

    // Exactly one element in the sheet is wired to the submit handler.
    const clickables = clickableEls(tree);
    const submitWired = clickables.filter((el) => el.props.onClick === confirm!.props.onClick);
    expect(submitWired).toHaveLength(1);
    expect(submitWired[0].props['data-testid']).toBe('bulk-sell-confirm');

    // Dismissing (overlay / ✕ / Cancel) closes but can never submit.
    overlay!.props.onClick();
    findOne(tree, 'bulk-sell-cancel-x')!.props.onClick();
    cancel!.props.onClick();
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onConfirm).toHaveBeenCalledTimes(0);

    // Only the explicit confirm tap runs the sell.
    await confirm!.props.onClick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
