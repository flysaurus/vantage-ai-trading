// ═══════════════════════════════════════════════════════════════
// tests/snaptrade-position-mapping.test.ts
//   Unit tests for mapSnapPositionToBrokerPosition()
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/snaptrade-position-mapping.test.ts
//
// Covers the row→BrokerPosition mapping for SnapTrade's
// `GET /accounts/{id}/positions` payload:
//   - symbol as OBJECT (triple-nested) and as a bare STRING
//   - numeric coercion of `units` / `average_purchase_price`
//   - `average_purchase_price` missing → fall back to `price`
//   - cash-equivalent zero-unit rows and no-symbol rows are skipped
//   - NO fabricated `buyDate` (the positions endpoint carries no date)

import { describe, it, expect } from 'vitest';
import { mapSnapPositionToBrokerPosition } from '../lib/broker/snaptrade-broker';

describe('mapSnapPositionToBrokerPosition', () => {
  it('maps a triple-nested object symbol to ticker + name', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: { symbol: { symbol: 'TSLA', description: 'Tesla, Inc.' } },
      units: 10,
      price: 311.21,
      average_purchase_price: 250.5,
      open_pnl: 607.1,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.symbol).toBe('TSLA');
    expect(mapped!.name).toBe('Tesla, Inc.');
    expect(mapped!.shares).toBe(10);
    expect(mapped!.avgCost).toBe(250.5);
    expect(mapped!.totalCost).toBeCloseTo(2505, 5);
    expect(mapped!.type).toBe('Stock');
  });

  it('handles a two-level object symbol ({ symbol: "AAPL" })', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: { symbol: 'AAPL', description: 'Apple Inc.' },
      units: 5,
      average_purchase_price: 100,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.symbol).toBe('AAPL');
    expect(mapped!.name).toBe('Apple Inc.');
  });

  it('handles a bare-string symbol', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'MSFT',
      units: 3,
      price: 400,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.symbol).toBe('MSFT');
    // No description anywhere → name falls back to the ticker.
    expect(mapped!.name).toBe('MSFT');
  });

  it('coerces string numeric fields (units / average_purchase_price)', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'NVDA',
      units: '12.5',
      price: '120.00',
      average_purchase_price: '99.99',
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.shares).toBe(12.5);
    expect(mapped!.avgCost).toBe(99.99);
    expect(mapped!.totalCost).toBeCloseTo(1249.875, 5);
  });

  it('falls back to price when average_purchase_price is missing', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'GOOGL',
      units: 4,
      price: 175.25,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.avgCost).toBe(175.25);
    expect(mapped!.totalCost).toBeCloseTo(701, 5);
  });

  it('uses fractional_units when units is absent', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'AMZN',
      fractional_units: 2.5,
      price: 200,
      average_purchase_price: 180,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.shares).toBe(2.5);
  });

  it('skips a cash-equivalent row with zero units', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'SPAXX',
      units: 0,
      price: 1,
      cash_equivalent: true,
    });
    expect(mapped).toBeNull();
  });

  it('keeps a cash-equivalent row that has real units', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'SWVXX',
      units: 100,
      price: 1,
      average_purchase_price: 1,
      cash_equivalent: true,
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.shares).toBe(100);
  });

  it('skips rows with no resolvable symbol', () => {
    expect(mapSnapPositionToBrokerPosition({ units: 10, price: 50 })).toBeNull();
    expect(mapSnapPositionToBrokerPosition({ symbol: '', units: 10 })).toBeNull();
    expect(mapSnapPositionToBrokerPosition({ symbol: {}, units: 10 })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(mapSnapPositionToBrokerPosition(null)).toBeNull();
    expect(mapSnapPositionToBrokerPosition(undefined)).toBeNull();
    expect(mapSnapPositionToBrokerPosition('AAPL')).toBeNull();
  });

  it('NEVER fabricates a buyDate and emits only the fixed field set', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: { symbol: { symbol: 'TSLA', description: 'Tesla, Inc.' } },
      units: 10,
      price: 300,
      average_purchase_price: 250,
      open_pnl: 500,
      cash_equivalent: false,
      tax_lots: [{ units: 10 }],
      raw_extra: 'should-not-leak',
    });
    expect(mapped).not.toBeNull();
    // The positions payload carries NO acquisition date → field must be absent.
    expect('buyDate' in mapped!).toBe(false);
    expect(mapped!.buyDate).toBeUndefined();
    // Fixed field set — the raw payload must not be spread into the result.
    expect(Object.keys(mapped!).sort()).toEqual(
      ['avgCost', 'name', 'sector', 'shares', 'symbol', 'totalCost', 'type'],
    );
  });

  it('detects ETFs from an asset_type hint', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'VOO',
      units: 2,
      price: 500,
      average_purchase_price: 450,
      asset_type: 'ETF',
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.type).toBe('ETF');
  });

  it('passes through a trimmed sector when provided', () => {
    const mapped = mapSnapPositionToBrokerPosition({
      symbol: 'XOM',
      units: 5,
      price: 110,
      average_purchase_price: 100,
      sector: '  Energy  ',
    });
    expect(mapped).not.toBeNull();
    expect(mapped!.sector).toBe('Energy');
  });
});
