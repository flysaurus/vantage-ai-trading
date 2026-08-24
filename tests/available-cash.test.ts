// ═══════════════════════════════════════════════════════════════
// tests/available-cash.test.ts — Unit tests for available-cash reservation math
// ═══════════════════════════════════════════════════════════════
//
// Run: npx vitest run tests/available-cash.test.ts
//
// Covers:
//   - OPEN / SUBMITTED orders reserve their full requested_amount
//   - PARTIALLY_FILLED orders reserve ONLY the unfilled remainder
//     (requested_amount − filled_qty × filled_price)
//   - FILLED / CANCELLED orders drop out of the reservation entirely
//   - notional and requestedQty × referencePrice fallbacks
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import {
  sumOpenReservedAmount,
  availableCash,
  type OpenOrderReservation,
} from '../lib/available-cash';

describe('sumOpenReservedAmount', () => {
  it('reserves full requested_amount for open orders', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'open', requestedAmount: 100 },
      { status: 'submitted', requestedAmount: 50 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(150);
  });

  it('releases the filled portion of a partially_filled order', () => {
    // $95 reserved, $30 already filled → only $65 should stay reserved.
    const orders: OpenOrderReservation[] = [
      { status: 'partially_filled', requestedAmount: 95, filledQty: 3, filledPrice: 10 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(65);
  });

  it('uses explicit filledCost when filledQty/filledPrice are absent', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'partially_filled', requestedAmount: 95, filledCost: 30 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(65);
  });

  it('clamps at zero when the filled portion exceeds the reservation', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'partially_filled', requestedAmount: 10, filledQty: 2, filledPrice: 9 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(0);
  });

  it('drops filled and cancelled orders entirely', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'filled', requestedAmount: 100 },
      { status: 'cancelled', requestedAmount: 50 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(0);
  });

  it('falls back to notional when requested_amount is null', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'open', notional: 200 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(200);
  });

  it('falls back to requestedQty × reference price when no amount fields', () => {
    const orders: OpenOrderReservation[] = [
      { status: 'open', requestedQty: 4, fillPrice: 25 },
    ];
    expect(sumOpenReservedAmount(orders)).toBe(100);
  });
});

describe('availableCash', () => {
  it('subtracts open reservations from cash', () => {
    expect(availableCash({ cash: 1000 }, 200)).toBe(800);
  });

  it('clamps at zero', () => {
    expect(availableCash({ cash: 100 }, 200)).toBe(0);
  });

  it('falls back to buyingPower when cash is absent', () => {
    expect(availableCash({ cash: null, buyingPower: 500 }, 100)).toBe(400);
  });

  it('returns 0 when no balance is available', () => {
    expect(availableCash(null)).toBe(0);
  });
});
