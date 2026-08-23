'use client'
import { useEffect, useState } from 'react'
import { consumeLotsFIFO, type Lot } from '@/lib/fifo-engine'

interface Position {
 symbol: string
 qty: number
 currentPrice: number
}

interface SellModalProps {
 positions: Position[]
 onClose: () => void
 onConfirm?: (percentSold?: number) => void
 /** Enable proportional percentage sell (for basket sells) */
 showPercentOption?: boolean
 /** Active lots per symbol (remaining_qty > 0) for FIFO disclosure. */
 lotsBySymbol?: Record<string, Lot[]>
}

const PRESETS = [25, 50, 75, 100] as const

function formatLotDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

export default function SellModal({ positions, onClose, onConfirm, showPercentOption, lotsBySymbol }: SellModalProps) {
 const total = positions.reduce((s, p) => s + p.qty * p.currentPrice, 0)
 const [submitted, setSubmitted] = useState(false)
 const [sellPercent, setSellPercent] = useState(100)
 const [sliderValue, setSliderValue] = useState(100)

 useEffect(() => {
   const prev = document.body.style.overflow;
   document.body.style.overflow = 'hidden';
   document.body.style.position = 'fixed';
   document.body.style.width = '100%';
   return () => {
     document.body.style.overflow = prev;
     document.body.style.position = '';
     document.body.style.width = '';
   };
 }, [])

 const handleDone = () => {
   (onConfirm ?? onClose)()
 }

 const percentValue = showPercentOption ? sellPercent : 100
 const estimatedValue = total * (percentValue / 100)
 const displayPercent = showPercentOption ? percentValue : 100

 // ── FIFO disclosure: specific consumed lots for a symbol ──
 const consumedLotsFor = (symbol: string): { filledAt: string; qty: number }[] => {
   const lots = lotsBySymbol?.[symbol]
   if (!lots || lots.length === 0) return []
   const active = lots.filter(l => l.remaining_qty > 0)
   if (active.length === 0) return []
   const pos = positions.find(p => p.symbol === symbol)
   if (!pos) return []
   const sellQty = pos.qty * (percentValue / 100)
   const totalAvail = active.reduce((s, l) => s + l.remaining_qty, 0)
   if (sellQty <= 0 || totalAvail <= 0) return []
   try {
     return consumeLotsFIFO(active, Math.min(sellQty, totalAvail)).consumed.map(c => {
       const lot = active.find(l => l.id === c.lot_id)
       return { filledAt: lot?.filled_at ?? '', qty: c.qty_consumed }
     })
   } catch {
     return []
   }
 }

 return (
 <div
 onClick={onClose}
 style={{
 position: 'fixed',
 top: 0, left: 0, right: 0, bottom: 0,
 backgroundColor: 'rgba(0,0,0,0.8)',
 zIndex: 9999,
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 padding: '20px',
 touchAction: 'none',
 }}
 >
 <div
 onClick={e => e.stopPropagation()}
 style={{
 backgroundColor: '#1a2235',
 borderRadius: '16px',
 border: '1px solid #2a3448',
 width: '100%',
 maxWidth: '400px',
 maxHeight: showPercentOption ? '85vh' : '75vh',
 display: 'flex',
 flexDirection: 'column',
 overflow: 'hidden'
 }}
 >
 {submitted ? (
 /* ─── SUBMITTED STATE ─── */
 <div style={{
 display: 'flex',
 flexDirection: 'column',
 alignItems: 'center',
 justifyContent: 'center',
 padding: '40px 20px 32px',
 textAlign: 'center'
 }}>
 <div style={{
 width: '56px',
 height: '56px',
 borderRadius: '50%',
 background: '#22d3ee',
 display: 'flex',
 alignItems: 'center',
 justifyContent: 'center',
 marginBottom: '20px'
 }}>
 <span style={{ fontSize: '28px', color: '#0f172a', fontWeight: '700', lineHeight: 1 }}>✓</span>
 </div>
 <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff', marginBottom: '8px' }}>
 Order Submitted
 </div>
 <div style={{ fontSize: '14px', color: '#e2e8f0', marginBottom: '6px' }}>
 {positions.map(p => p.symbol).join(' · ')}
 {showPercentOption && displayPercent < 100 ? ` · ${displayPercent}% each` : ''}
 </div>
 <div style={{ fontSize: '14px', color: '#e2e8f0', marginBottom: '24px' }}>
 Market
 </div>
 <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '28px' }}>
 Your order has been queued.
 </div>
 <button
 onClick={handleDone}
 style={{
 width: '100%',
 padding: '14px',
 background: '#22d3ee',
 border: 'none',
 borderRadius: '10px',
 color: '#0f172a',
 fontSize: '14px',
 fontWeight: '700',
 cursor: 'pointer'
 }}
 >
 Done
 </button>
 </div>
 ) : (
 <>
 {/* HEADER */}
 <div style={{
 display: 'flex',
 justifyContent: 'space-between',
 alignItems: 'center',
 padding: '18px 20px',
 borderBottom: '1px solid #2a3448'
 }}>
 <span style={{ fontSize: '18px', fontWeight: '700', color: '#ffffff' }}>
 {positions.length === 1
 ? `Sell ${positions[0].symbol}`
 : `Sell Selected (${positions.length})`}
 </span>
 <button
 onClick={onClose}
 style={{
 background: 'none', border: 'none', color: '#e2e8f0',
 fontSize: '22px', cursor: 'pointer', lineHeight: 1, padding: '0 4px'
 }}
 >×</button>
 </div>

 {/* PERCENTAGE SELL CONTROLS (basket mode) */}
 {showPercentOption && (
 <div style={{
   padding: '14px 20px',
   borderBottom: '1px solid #2a3448',
 }}>
   <div style={{
     display: 'flex', justifyContent: 'space-between', alignItems: 'center',
     marginBottom: '10px',
   }}>
     <span style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 500 }}>Sell Percentage</span>
     <span style={{
       background: 'rgba(34,211,238,0.12)',
       border: '1px solid rgba(34,211,238,0.25)',
       borderRadius: '8px',
       padding: '4px 10px',
       color: '#22d3ee',
       fontSize: '14px',
       fontWeight: '700',
     }}>
       {sellPercent}%
     </span>
   </div>

   {/* Preset buttons */}
   <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
     {PRESETS.map(pct => (
       <button
         key={pct}
         onClick={() => { setSellPercent(pct); setSliderValue(pct) }}
         style={{
           flex: 1,
           padding: '8px 0',
           borderRadius: '8px',
           border: sellPercent === pct
             ? '1px solid rgba(34,211,238,0.5)'
             : '1px solid rgba(255,255,255,0.08)',
           background: sellPercent === pct
             ? 'rgba(34,211,238,0.12)'
             : 'transparent',
           color: sellPercent === pct ? '#22d3ee' : '#94a3b8',
           fontSize: '13px',
           fontWeight: sellPercent === pct ? '700' : '500',
           cursor: 'pointer',
         }}
       >
         {pct}%
       </button>
     ))}
   </div>

   {/* Slider */}
   <div style={{ position: 'relative', height: '24px', display: 'flex', alignItems: 'center' }}>
     <input
       type="range"
       min="1"
       max="100"
       value={sliderValue}
       onChange={e => {
         const v = parseInt(e.target.value)
         setSliderValue(v)
         setSellPercent(v)
       }}
       style={{
         width: '100%',
         height: '6px',
         WebkitAppearance: 'none',
         appearance: 'none',
         background: `linear-gradient(to right, #ef4444 ${sliderValue}%, #334155 ${sliderValue}%)`,
         borderRadius: '3px',
         outline: 'none',
         cursor: 'pointer',
       }}
     />
   </div>
   <style>{`
     input[type="range"]::-webkit-slider-thumb {
       -webkit-appearance: none;
       width: 20px; height: 20px;
       border-radius: 50%;
       background: #ef4444;
       border: 2px solid #ffffff;
       cursor: pointer;
       box-shadow: 0 2px 6px rgba(0,0,0,0.3);
     }
   `}</style>

   {/* Per-stock breakdown */}
   <div style={{ marginTop: '12px' }}>
     <div style={{ color: '#64748b', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
       SHARES TO SELL · {sellPercent}% of each
     </div>
     {positions.map(pos => (
       <div key={pos.symbol} style={{
         display: 'flex', justifyContent: 'space-between',
         padding: '4px 0', fontSize: '12px',
       }}>
         <span style={{ color: '#94a3b8' }}>{pos.symbol}</span>
         <span style={{ color: '#e2e8f0' }}>
           {(pos.qty * sellPercent / 100).toFixed(4)}sh
           {' · '}~${(pos.qty * pos.currentPrice * sellPercent / 100).toFixed(2)}
         </span>
       </div>
     ))}
   </div>
 </div>
 )}

 {/* STOCK LIST */}
 <div style={{
   overflowY: 'auto',
   flex: 1,
   WebkitOverflowScrolling: 'touch',
   overscrollBehavior: 'contain',
 }}>
 {positions.map((pos, i) => (
 <div
 key={pos.symbol}
 style={{
 display: 'flex',
 justifyContent: 'space-between',
 alignItems: 'center',
 padding: '14px 20px',
 borderBottom: i < positions.length - 1
 ? '1px solid #2a3448' : 'none'
 }}
 >
 <div>
 <div style={{ fontSize: '16px', fontWeight: '700', color: '#ffffff' }}>
 {pos.symbol}
 </div>
 <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '3px' }}>
 {pos.qty.toFixed(4)} shares
 {showPercentOption && percentValue < 100
   ? ` · selling ${(pos.qty * percentValue / 100).toFixed(4)}`
   : ''}
 </div>
 {(() => {
   const lots = consumedLotsFor(pos.symbol)
   if (lots.length === 0) return null
   const label = lots.length === 1
     ? `FIFO · 1 lot · ${lots[0].qty.toFixed(4)} @ ${formatLotDate(lots[0].filledAt)}`
     : `FIFO · ${lots.length} lots · ${lots.map(l => `${l.qty.toFixed(2)} @ ${formatLotDate(l.filledAt)}`).join(' · ')}`
   return (
     <div style={{ fontSize: '11px', color: '#22d3ee', marginTop: '3px', fontWeight: 500 }}>
       {label}
     </div>
   )
 })()}
 </div>
 <div style={{ textAlign: 'right' }}>
 <div style={{ fontSize: '16px', fontWeight: '600', color: '#ffffff' }}>
 ~${(pos.qty * pos.currentPrice * (showPercentOption ? percentValue / 100 : 1))
 .toLocaleString(undefined, { minimumFractionDigits: 2 })}
 </div>
 <div style={{ fontSize: '12px', color: '#e2e8f0', marginTop: '3px' }}>
 {showPercentOption && percentValue < 100
   ? `${percentValue}% of shares · Market`
   : 'All shares · Market'}
 </div>
 </div>
 </div>
 ))}
 </div>

 {/* FOOTER */}
 <div style={{
 padding: '16px 20px',
 borderTop: '1px solid #2a3448'
 }}>
 <div style={{
 fontSize: '12px', color: '#e2e8f0', textAlign: 'center', marginBottom: '6px'
 }}>
 {showPercentOption && percentValue < 100
   ? `${percentValue}% of shares · Market order · Day`
   : 'All shares · Market order · Day'}
 </div>
 <div style={{
 fontSize: '20px', fontWeight: '700', color: '#22d3ee',
 textAlign: 'center', marginBottom: '16px'
 }}>
 Est. ${estimatedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
 </div>
 <div style={{ display: 'flex', gap: '12px' }}>
 <button
 onClick={onClose}
 style={{
 flex: 1, padding: '14px',
 background: 'transparent',
 border: '1px solid #374151',
 borderRadius: '10px',
 color: '#94a3b8', fontSize: '14px', cursor: 'pointer'
 }}
 >
 Cancel
 </button>
 <button
 onClick={() => {
   setSubmitted(true)
   if (onConfirm) {
     // Pass the sell percentage so caller can scale shares
     (onConfirm as any)(percentValue)
   }
 }}
 style={{
 flex: 1, padding: '14px',
 background: '#ef4444',
 border: 'none',
 borderRadius: '10px',
 color: '#ffffff',
 fontSize: '14px', fontWeight: '600',
 cursor: 'pointer'
 }}
 >
 {showPercentOption && percentValue < 100
   ? `Sell ${percentValue}%`
   : 'Confirm Sell'}
 </button>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 )
}
