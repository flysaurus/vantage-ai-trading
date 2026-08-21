// ─── Order Formatting + Cancellation Reason Unit Test ─────────
// Locks in the single-sourced order money/share formatting (Bug 4) and the
// in-app cancellation reasons (Bug 3). These are the exact helpers consumed by
// the in-app cards (OrderDisplay / OrdersTab / TradeTab) AND the email/bell
// templates, so a regression in any surface fails here.
//
// Run: npx tsx lib/__tests__/order-format.spec.ts

export {};

import {
  fmtShares,
  fmtDollars,
  fmtPct,
  resolveUnit,
  authoritativeRequested,
  derivedRequested,
  cancelReasonText,
  isWorkingStatus,
  WORKING_STATUSES,
} from '../order-format';

let failures = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}
function eq(actual: unknown, expected: unknown, label: string) {
  assert(actual === expected, `${label} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

// ── 1. Honest null fallback — never "0" or "" (Bug 4) ─────────
console.log('\n[1] null fallback');
eq(fmtShares(null), '—', 'fmtShares(null) → em-dash');
eq(fmtShares(undefined), '—', 'fmtShares(undefined) → em-dash');
eq(fmtShares(NaN), '—', 'fmtShares(NaN) → em-dash');
eq(fmtDollars(null), '—', 'fmtDollars(null) → em-dash');
eq(fmtDollars(undefined), '—', 'fmtDollars(undefined) → em-dash');
eq(fmtPct(null), '—', 'fmtPct(null) → em-dash');

// ── 2. Precision — 4dp shares, trailing zeros stripped ────────
console.log('\n[2] precision');
eq(fmtShares(3), '3', 'fmtShares(3) → 3');
eq(fmtShares(3.2), '3.2', 'fmtShares(3.2) → 3.2');
eq(fmtShares(12.5), '12.5', 'fmtShares(12.5) → 12.5');
eq(fmtShares(701.61), '701.61', 'fmtShares(701.61) → 701.61');
eq(fmtShares(0.06), '0.06', 'fmtShares(0.06) → 0.06');
eq(fmtShares(1.00004), '1', 'fmtShares(1.00004) → 1 (4dp rounds)');
eq(fmtDollars(0), '$0.00', 'fmtDollars(0) → $0.00 (zero is real)');
eq(fmtDollars(701.61), '$701.61', 'fmtDollars(701.61) → $701.61');
eq(fmtDollars(1000), '$1000.00', 'fmtDollars(1000) → $1000.00');

// ── 3. Four-field requested model (single-sourced) ────────────
console.log('\n[3] requested model');
eq(resolveUnit({ orderUnit: 'dollars' }), 'dollars', 'resolveUnit explicit dollars');
eq(resolveUnit({ orderUnit: 'shares' }), 'shares', 'resolveUnit explicit shares');
eq(resolveUnit({ requestedAmount: 100 }), 'dollars', 'resolveUnit inferred dollars');
eq(resolveUnit({ requestedQty: 10 }), 'shares', 'resolveUnit inferred shares');
eq(authoritativeRequested({ orderUnit: 'dollars', requestedAmount: 1000 }), '$1000.00', 'auth dollars');
eq(authoritativeRequested({ orderUnit: 'shares', requestedQty: 12.5 }), '12.5 shares', 'auth shares plural');
eq(authoritativeRequested({ orderUnit: 'shares', requestedQty: 1 }), '1 share', 'auth shares singular');
eq(authoritativeRequested({ orderUnit: 'shares', requestedQty: null }), '—', 'auth shares absent');
eq(derivedRequested({ orderUnit: 'dollars', requestedAmount: 1000, requestedQty: 3.27 }), '≈3.27 shares est.', 'derived dollars→shares');
eq(derivedRequested({ orderUnit: 'shares', requestedQty: 10, requestedAmount: 250 }), '≈$250.00 est.', 'derived shares→dollars');
eq(derivedRequested({ orderUnit: 'dollars', requestedAmount: 1000 }), '', 'derived empty when no est');

// ── 4. Cancellation reasons (Bug 3) — 5 real reasons ──────────
console.log('\n[4] cancellation reasons');
eq(cancelReasonText({ status: 'rejected' }), 'Rejected by your broker before it could be opened.', 'rejected → broker-rejected');
eq(cancelReasonText({ status: 'cancelled', cancelReason: 'user_cancelled' }), 'Cancelled by you.', 'user_cancelled');
eq(cancelReasonText({ status: 'cancelled', cancelReason: 'already_filled' }), 'Your cancel didn\u2019t go through — the order had already filled.', 'already_filled');
eq(cancelReasonText({ status: 'cancelled', cancelReason: 'stale_guard' }), 'Marked cancelled after we couldn\u2019t confirm status with your broker.', 'stale_guard');
eq(cancelReasonText({ status: 'cancelled', cancelReason: 'external' }), 'Cancelled outside Vantage (at your brokerage, or the order expired).', 'external');
eq(cancelReasonText({ status: 'cancelled', cancelReason: null }), 'Cancelled.', 'cancelled, no reason → generic');
eq(cancelReasonText({ status: 'open' }), '', 'open → no reason text');
eq(cancelReasonText({ status: 'filled' }), '', 'filled → no reason text');

// ── 5. Working-status predicate (open-filter + cancel button) ─
console.log('\n[5] working status (open filter)');
for (const s of WORKING_STATUSES) {
  eq(isWorkingStatus(s), true, `isWorkingStatus('${s}') → true`);
}
eq(isWorkingStatus('submitted'), true, 'submitted visible immediately post-submit');
eq(isWorkingStatus('pending'), true, 'pending visible');
eq(isWorkingStatus('open'), true, 'open visible');
eq(isWorkingStatus('filled'), false, 'filled NOT working');
eq(isWorkingStatus('cancelled'), false, 'cancelled NOT working');
eq(isWorkingStatus('rejected'), false, 'rejected NOT working');
eq(isWorkingStatus('partially_filled'), false, 'partially_filled NOT working (normalized to open upstream)');
eq(isWorkingStatus('SUBMITTED'), true, 'case-insensitive SUBMITTED → true');
eq(isWorkingStatus(null), false, 'null → false');
eq(isWorkingStatus(undefined), false, 'undefined → false');

// ── Result ────────────────────────────────────────────────────
console.log('');
if (failures === 0) {
  console.log('ALL PASS ✓');
  process.exit(0);
} else {
  console.error(`${failures} FAILURE(S) ✗`);
  process.exit(1);
}
