'use client'

// ═══════════════════════════════════════════════════════════════
// components/portfolio/BulkSellSheet.tsx
//
// Confirmation step for the Holdings "Select" bulk action.
//
// Before this sheet existed, "Sell Selected" fired straight at
// /api/broker/execute-trade for every selected symbol — no confirmation,
// no FIFO disclosure, per-symbol errors swallowed. That is the one place in
// the app where a single tap could liquidate a whole account silently, so it
// now goes through the same review step as every other sell surface:
//
//   1. list exactly what is being sold (symbol, shares, est. value)
//   2. disclose the specific tax lots FIFO will consume for each symbol
//   3. require an explicit "Sell N positions" tap
//
// Lots are read from the same `position_lots` ledger and through the same
// `consumeLotsFIFO` engine the SellModal uses, so the disclosure here can
// never disagree with what the ledger write actually consumes.
// ═══════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/auth/supabase-client'
import { consumeLotsFIFO, type Lot } from '@/lib/fifo-engine'
import { usePageScrollLock } from '@/lib/ui/scroll-lock'

export interface BulkSellItem {
  symbol: string
  qty: number
  price: number
}

export interface BulkSellBasket {
  id: string
  name: string
  symbols: string[]
}

interface BulkSellSheetProps {
  items: BulkSellItem[]
  baskets: BulkSellBasket[]
  onClose: () => void
  onConfirm: () => void | Promise<void>
}

const fmtUsd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function fmtLotDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function BulkSellSheet({ items, baskets, onClose, onConfirm }: BulkSellSheetProps) {
  const [lotsBySymbol, setLotsBySymbol] = useState<Record<string, Lot[]>>({})
  const [lotsLoading, setLotsLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  usePageScrollLock(true)

  const symbols = useMemo(
    () => Array.from(new Set(items.map(i => i.symbol).filter(Boolean))),
    [items]
  )
  const symbolsKey = symbols.join(',')

  // ── Active lots for FIFO disclosure ──
  useEffect(() => {
    let cancelled = false
    if (symbols.length === 0) {
      setLotsBySymbol({})
      setLotsLoading(false)
      return
    }
    ;(async () => {
      try {
        const client = getSupabaseBrowserClient()
        const { data: { session } } = await client.auth.getSession()
        const uid = session?.user?.id
        if (!uid) {
          if (!cancelled) { setLotsBySymbol({}); setLotsLoading(false) }
          return
        }
        const { data, error } = await client
          .from('position_lots')
          .select('*')
          .eq('user_id', uid)
          .in('ticker', symbols)
          .gt('remaining_qty', 0)
          .order('filled_at', { ascending: true })
        if (cancelled) return
        if (error) {
          console.error('[BulkSellSheet] lot fetch error:', error.message)
          setLotsBySymbol({}); setLotsLoading(false)
          return
        }
        const typed: Record<string, Lot[]> = {}
        for (const row of (data || []) as any[]) {
          const lot: Lot = {
            id: row.id as string,
            ticker: row.ticker as string,
            qty: Number(row.qty),
            remaining_qty: Number(row.remaining_qty),
            price_at_fill: Number(row.price_at_fill),
            filled_at: row.filled_at as string,
          }
          if (!typed[lot.ticker]) typed[lot.ticker] = []
          typed[lot.ticker].push(lot)
        }
        setLotsBySymbol(typed)
        setLotsLoading(false)
      } catch (e) {
        if (!cancelled) { setLotsBySymbol({}); setLotsLoading(false) }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey])

  // ── FIFO disclosure: the lots this sell will actually consume ──
  const consumedLotsFor = (symbol: string, sellQty: number): { qty: number; filledAt: string }[] => {
    const lots = lotsBySymbol[symbol]
    if (!lots || lots.length === 0) return []
    const active = lots.filter(l => l.remaining_qty > 0)
    if (active.length === 0) return []
    const totalAvail = active.reduce((s, l) => s + l.remaining_qty, 0)
    if (sellQty <= 0 || totalAvail <= 0) return []
    try {
      return consumeLotsFIFO(active, Math.min(sellQty, totalAvail)).consumed.map(c => {
        const lot = active.find(l => l.id === c.lot_id)
        return { qty: c.qty_consumed, filledAt: lot?.filled_at ?? '' }
      })
    } catch {
      return []
    }
  }

  const totalValue = items.reduce((s, i) => s + i.qty * i.price, 0)
  const basketCount = baskets.length
  const positionCount = items.length
  const totalTargets = positionCount + basketCount

  const handleConfirm = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      data-testid="bulk-sell-sheet"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        data-testid="bulk-sell-panel"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 430,
          maxHeight: '88vh',
          background: 'var(--v-card)',
          border: '0.5px solid var(--v-card-border)',
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'var(--font-sans)',
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: '18px 20px 10px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--v-loss-label)',
            }}>
              Confirm
            </div>
            <div
              data-testid="bulk-sell-title"
              style={{
                fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 500,
                fontSize: 22, color: 'var(--v-text-primary)', marginTop: 4, letterSpacing: 0,
              }}
            >
              {totalTargets === 1 ? 'Sell 1 position' : `Sell ${totalTargets} positions`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--v-text-secondary)', marginTop: 4 }}>
              Market orders · sells each position in full
            </div>
          </div>
          <button
            type="button"
            data-testid="bulk-sell-cancel-x"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--v-text-secondary)', fontSize: 20, lineHeight: 1, padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ overflowY: 'auto', padding: '4px 20px 0', flex: 1 }} data-testid="bulk-sell-body">

          {/* Total */}
          <div style={{
            background: 'var(--v-por-card)',
            border: '0.5px solid var(--v-card-border)',
            borderRadius: 14, padding: '12px 14px',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--v-text-secondary)' }}>
              Estimated proceeds
            </span>
            <span data-testid="bulk-sell-total" style={{ fontSize: 18, fontWeight: 700, color: 'var(--v-text-primary)' }}>
              {fmtUsd(totalValue)}
            </span>
          </div>

          {/* Positions */}
          {positionCount > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 8 }}>
                POSITIONS
              </div>
              <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 14, overflow: 'hidden' }}>
                {items.map((it, idx) => {
                  const consumed = consumedLotsFor(it.symbol, it.qty)
                  const totalAvail = (lotsBySymbol[it.symbol] || [])
                    .filter(l => l.remaining_qty > 0)
                    .reduce((s, l) => s + l.remaining_qty, 0)
                  const shortfall = !lotsLoading && totalAvail > 0 && totalAvail < it.qty - 1e-9
                  const noLots = !lotsLoading && totalAvail <= 0
                  return (
                    <div
                      key={it.symbol}
                      data-testid={`bulk-sell-item-${it.symbol}`}
                      style={{
                        padding: '11px 14px',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--v-card-border)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-text-primary)' }}>{it.symbol}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-text-secondary)' }}>
                          {it.qty % 1 === 0 ? it.qty : it.qty.toFixed(4)} sh · {fmtUsd(it.qty * it.price)}
                        </span>
                      </div>
                      <div
                        data-testid={`bulk-sell-fifo-${it.symbol}`}
                        style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginTop: 4, lineHeight: 1.45 }}
                      >
                        {lotsLoading ? (
                          'Checking tax lots…'
                        ) : consumed.length > 0 ? (
                          <>
                            <span style={{ fontWeight: 700, color: 'var(--v-text-muted)' }}>FIFO · </span>
                            {consumed.length === 1 ? '1 lot · ' : `${consumed.length} lots · `}
                            {consumed
                              .map(c => `${c.qty % 1 === 0 ? c.qty : c.qty.toFixed(4)} @ ${fmtLotDate(c.filledAt)}`)
                              .join(' · ')}
                          </>
                        ) : noLots ? (
                          'No tracked lots — cost basis unavailable for this position.'
                        ) : (
                          'Lot detail unavailable.'
                        )}
                        {shortfall && (
                          <span style={{ color: 'var(--v-warn)', fontWeight: 600 }}>
                            {' '}Lots cover {totalAvail % 1 === 0 ? totalAvail : totalAvail.toFixed(4)} of {it.qty % 1 === 0 ? it.qty : it.qty.toFixed(4)} sh.
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Baskets */}
          {basketCount > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--v-text-muted)', marginBottom: 8 }}>
                BASKETS
              </div>
              <div style={{ background: 'var(--v-card)', border: '0.5px solid var(--v-card-border)', borderRadius: 14, overflow: 'hidden' }}>
                {baskets.map((b, idx) => (
                  <div
                    key={b.id}
                    data-testid={`bulk-sell-basket-${b.id}`}
                    style={{
                      padding: '11px 14px',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--v-card-border)',
                    }}
                  >
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--v-text-primary)' }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--v-text-secondary)', marginTop: 4 }}>
                      {b.symbols.length} active position{b.symbols.length === 1 ? '' : 's'}
                      {b.symbols.length > 0 ? ` · ${b.symbols.join(', ')}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notice */}
          <div style={{
            marginTop: 16, marginBottom: 4,
            background: 'var(--v-warn-dim)',
            border: '0.5px solid var(--v-warn)',
            borderRadius: 12, padding: '10px 12px',
            fontSize: 11.5, lineHeight: 1.5, color: 'var(--v-text-secondary)',
          }}>
            This places {totalTargets === 1 ? 'a market sell order' : `${totalTargets} market sell orders`} immediately.
            Each position is sold in full, using FIFO cost basis.
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: '12px 20px 20px',
          borderTop: '0.5px solid var(--v-card-border)',
          display: 'flex', gap: 10,
        }}>
          <button
            type="button"
            data-testid="bulk-sell-cancel"
            onClick={onClose}
            style={{
              flex: 1, padding: '13px 16px', borderRadius: 12,
              background: 'transparent',
              border: '1px solid var(--v-card-border)',
              color: 'var(--v-text-primary)',
              fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="bulk-sell-confirm"
            onClick={handleConfirm}
            disabled={submitting}
            style={{
              flex: 1.4, padding: '13px 16px', borderRadius: 12,
              background: 'var(--v-loss-label)',
              border: 'none',
              color: 'var(--v-accent-text)',
              fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)',
              cursor: submitting ? 'default' : 'pointer',
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting
              ? 'Selling…'
              : positionCount > 0
                ? `Sell ${positionCount}${basketCount > 0 ? ` + ${basketCount} basket${basketCount === 1 ? '' : 's'}` : ''}`
                : `Sell ${basketCount} basket${basketCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
