'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TradeRec } from '@/lib/ai/trade-recs';

// ─── TradeRecTicket ──────────────────────────────────────────────────────────
// Multi-leg ORDER TICKET for a chat reply's trade recommendations.
//
// Replaces the old behaviour where the card's primary button fired the
// rebalance chat flow. This is a real order ticket: every leg from the
// recommendation is listed, pre-filled with its dollar amount, editable,
// individually includable, and executed leg-by-leg through the SAME
// executeTrade() path as the single-symbol AI TradeTicket.
//
// Reads live quotes on open (GET /api/finnhub/quote) — never writes until the
// user presses Confirm.

export interface TradeRecLegInput {
  ticker: string;
  side: 'BUY' | 'SELL';
  amount: number;
  price: number;
  shares: number;
}

interface LegState {
  key: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  amount: string;
  price: number;
  include: boolean;
  status: 'idle' | 'pending' | 'filled' | 'failed';
  error?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  recs: TradeRec[];
  availableCash: number;
  readOnly?: boolean;
  /** Execute one leg. Returns success/error; the ticket manages its own status. */
  onExecuteLeg: (leg: TradeRecLegInput) => Promise<{ success: boolean; error?: string }>;
}

const num = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);

export default function TradeRecTicket({ isOpen, onClose, recs, availableCash, readOnly, onExecuteLeg }: Props) {
  const [legs, setLegs] = useState<LegState[]>([]);
  const [executing, setExecuting] = useState(false);

  // ── Seed legs + fetch live quotes each time the ticket opens ──
  useEffect(() => {
    if (!isOpen) return;
    const seeded: LegState[] = (recs || []).map((r, i) => {
      const side: 'BUY' | 'SELL' =
        String((r as any).side || '').toLowerCase() === 'trim' ? 'SELL' : 'BUY';
      const amount = num((r as any).amount) > 0 ? num((r as any).amount) : 0;
      return {
        key: `${r.ticker}-${side}-${i}`,
        ticker: String(r.ticker || '').toUpperCase(),
        side,
        amount: amount > 0 ? String(Math.round(amount)) : '',
        price: 0,
        include: true,
        status: 'idle',
      };
    });
    setLegs(seeded);

    let cancelled = false;
    (async () => {
      const prices = await Promise.all(
        seeded.map(async (l) => {
          try {
            const res = await fetch(`/api/finnhub/quote?symbol=${encodeURIComponent(l.ticker)}`);
            if (!res.ok) return 0;
            const d = await res.json();
            return num(d?.c);
          } catch {
            return 0;
          }
        }),
      );
      if (cancelled) return;
      setLegs((prev) => prev.map((l, i) => ({ ...l, price: prices[i] || 0 })));
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const included = useMemo(() => legs.filter((l) => l.include), [legs]);

  const total = useMemo(
    () =>
      included.reduce((sum, l) => {
        const a = Number(l.amount);
        if (Number.isFinite(a) && a > 0) return sum + a;
        if (l.price > 0) return sum + 0;
        return sum;
      }, 0),
    [included],
  );

  const estShares = useCallback((l: LegState) => {
    const a = Number(l.amount);
    if (!Number.isFinite(a) || a <= 0) return 0;
    if (l.price > 0) return a / l.price;
    return 0;
  }, []);

  const overBudget = availableCash > 0 && total > availableCash;
  const remaining = included.filter((l) => l.status !== 'filled');
  const canConfirm =
    !readOnly && !executing && remaining.length > 0 && remaining.some((l) => {
      const a = Number(l.amount);
      return Number.isFinite(a) && a > 0;
    });

  const handleConfirm = useCallback(async () => {
    if (!canConfirm) return;
    setExecuting(true);
    // Only legs that haven't already been placed — never re-send a filled leg
    // (a double send would duplicate a live order).
    const toPlace = included.filter((l) => l.status !== 'filled');
    // Sequential — one order at a time, each leg statused independently.
    for (const leg of toPlace) {
      setLegs((prev) => prev.map((l) => (l.key === leg.key ? { ...l, status: 'pending', error: undefined } : l)));
      const amt = Number(leg.amount);
      const shares = leg.price > 0 ? amt / leg.price : 0;
      let result: { success: boolean; error?: string } = { success: false, error: 'No price available' };
      try {
        result = await onExecuteLeg({
          ticker: leg.ticker,
          side: leg.side,
          amount: amt,
          price: leg.price,
          shares,
        });
      } catch (e: any) {
        result = { success: false, error: e?.message || 'Order failed' };
      }
      setLegs((prev) =>
        prev.map((l) =>
          l.key === leg.key
            ? { ...l, status: result.success ? 'filled' : 'failed', error: result.error }
            : l,
        ),
      );
    }
    setExecuting(false);
  }, [canConfirm, included, onExecuteLeg]);

  if (!isOpen) return null;

  const anyFilled = legs.some((l) => l.status === 'filled');
  const anyFailed = legs.some((l) => l.status === 'failed');
  const done = !executing && (anyFilled || anyFailed);
  return (
    <div
      data-testid="trade-rec-ticket"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(3,7,18,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
      onClick={() => { if (!executing) onClose(); }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 420,
          maxHeight: '85vh',
          overflowY: 'auto',
          background: 'var(--v-card)',
          border: '1px solid var(--v-card-border)',
          borderRadius: 16,
          boxShadow: 'var(--v-ask-shadow)',
          padding: '16px 16px 14px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--v-text-primary)' }}>Order ticket</div>
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)', marginTop: 2 }}>
              {legs.length} leg{legs.length === 1 ? '' : 's'} from this recommendation · review before you execute
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => { if (!executing) onClose(); }}
            style={{
              background: 'transparent', border: 'none', color: 'var(--v-text-muted)',
              fontSize: 18, lineHeight: 1, cursor: executing ? 'not-allowed' : 'pointer',
              padding: '2px 4px', fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>

        {/* Legs */}
        <div style={{ marginTop: 12 }}>
          {legs.map((l) => {
            const sh = estShares(l);
            const rowDim = !l.include || done;
            return (
              <div
                key={l.key}
                data-testid={`ticket-leg-${l.ticker}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0', borderTop: '1px solid var(--v-card-border)',
                  opacity: rowDim && !done ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={l.include}
                  disabled={executing || done}
                  onChange={(e) =>
                    setLegs((prev) => prev.map((x) => (x.key === l.key ? { ...x, include: e.target.checked } : x)))
                  }
                  style={{ width: 16, height: 16, accentColor: 'var(--v-accent-button)', flex: '0 0 auto' }}
                />
                <div style={{ minWidth: 78, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', color: l.side === 'SELL' ? 'var(--v-loss-label)' : 'var(--v-gain-label)' }}>
                    {l.side === 'SELL' ? 'TRIM' : 'BUY'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-text-primary)' }}>{l.ticker}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--v-text-muted)' }}>$</span>
                  <input
                    inputMode="decimal"
                    value={l.amount}
                    disabled={executing || done || !l.include}
                    onChange={(e) =>
                      setLegs((prev) => prev.map((x) => (x.key === l.key ? { ...x, amount: e.target.value.replace(/[^0-9.]/g, '') } : x)))
                    }
                    style={{
                      width: '100%', minWidth: 0, background: 'var(--v-card)',
                      border: '1px solid var(--v-card-border)', borderRadius: 8,
                      padding: '7px 9px', fontSize: 14, fontWeight: 600,
                      color: 'var(--v-text-primary)', fontFamily: 'inherit',
                    }}
                  />
                </div>
                <div style={{ minWidth: 92, textAlign: 'right', fontSize: 12, color: 'var(--v-text-muted)' }}>
                  {l.status === 'pending' && <span>Placing…</span>}
                  {l.status === 'filled' && <span style={{ color: 'var(--v-gain-label)', fontWeight: 700 }}>✓ Placed</span>}
                  {l.status === 'failed' && (
                    <span style={{ color: 'var(--v-loss-label)', fontWeight: 700 }}>✗ Failed</span>
                  )}
                  {l.status === 'idle' && (sh > 0 ? <span>≈{sh < 1 ? sh.toFixed(2) : Math.floor(sh)} sh</span> : <span>—</span>)}
                </div>
              </div>
            );
          })}
          {legs.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--v-text-muted)', padding: '10px 0' }}>No legs to trade.</div>
          )}
        </div>

        {/* Failed-leg detail */}
        {legs.filter((l) => l.status === 'failed').map((l) => (
          <div key={`err-${l.key}`} style={{ fontSize: 12, color: 'var(--v-loss-label)', marginTop: 4 }}>
            {l.ticker}: {l.error || 'Order failed'}
          </div>
        ))}

        {/* Totals */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--v-card-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--v-text-secondary)' }}>
            <span>Total ({included.length} leg{included.length === 1 ? '' : 's'})</span>
            <span style={{ fontWeight: 700, color: 'var(--v-text-primary)' }}>${Math.round(total).toLocaleString()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--v-text-muted)', marginTop: 4 }}>
            <span>Buying power</span>
            <span>${Math.round(availableCash).toLocaleString()}</span>
          </div>
          {overBudget && (
            <div data-testid="ticket-overbudget" style={{ fontSize: 12, color: 'var(--v-loss-label)', marginTop: 6 }}>
              Total exceeds buying power — orders may be rejected.
            </div>
          )}
          {readOnly && (
            <div style={{ fontSize: 12, color: 'var(--v-text-muted)', marginTop: 6 }}>
              Read-only account — orders can’t be placed from Vantage.
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button
            type="button"
            data-testid="ticket-confirm"
            disabled={!canConfirm}
            onClick={handleConfirm}
            style={{
              flex: 1, minHeight: 48, borderRadius: 14, border: 'none',
              background: 'var(--v-accent-button)', color: 'var(--v-accent-text)',
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              cursor: canConfirm ? 'pointer' : 'not-allowed', opacity: canConfirm ? 1 : 0.6,
            }}
          >
            {executing
              ? 'Placing orders…'
              : done
                ? (anyFailed ? `Retry ${remaining.length} failed leg${remaining.length === 1 ? '' : 's'}` : 'Done')
                : `Confirm ${included.length} order${included.length === 1 ? '' : 's'} · $${Math.round(total).toLocaleString()}`}
          </button>
          <button
            type="button"
            disabled={executing}
            onClick={onClose}
            style={{
              minHeight: 48, padding: '0 16px', borderRadius: 14,
              background: 'transparent', border: '1px solid var(--v-card-border)',
              color: 'var(--v-text-secondary)', fontSize: 14, fontWeight: 600,
              fontFamily: 'inherit', cursor: executing ? 'not-allowed' : 'pointer',
            }}
          >
            {done ? 'Close' : 'Cancel'}
          </button>
        </div>

        <div style={{ fontSize: 11, color: 'var(--v-text-faint)', marginTop: 8 }}>
          Market orders, dollar-denominated. Each leg is placed separately.
        </div>
      </div>
    </div>
  );
}
