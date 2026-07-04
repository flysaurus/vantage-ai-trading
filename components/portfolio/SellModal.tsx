'use client'
import { useEffect, useState } from 'react'

interface Position {
 symbol: string
 qty: number
 currentPrice: number
}

interface SellModalProps {
 positions: Position[]
 onClose: () => void
 onConfirm?: () => void
}

export default function SellModal({ positions, onClose, onConfirm }: SellModalProps) {
 const total = positions.reduce((s, p) => s + p.qty * p.currentPrice, 0)
 const [submitted, setSubmitted] = useState(false)

 useEffect(() => {
   const prev = document.body.style.overflow;
   document.body.style.overflow = 'hidden';
   // Also prevent touch-scroll on iOS
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
 maxWidth: '380px',
 maxHeight: '75vh',
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
 <div style={{
 fontSize: '20px',
 fontWeight: '700',
 color: '#ffffff',
 marginBottom: '8px'
 }}>
 Order Submitted
 </div>
 <div style={{
 fontSize: '14px',
 color: '#e2e8f0',
 marginBottom: '6px'
 }}>
 {positions.map(p => p.symbol).join(' · ')}
 {positions.length === 1 ? ` · ${positions[0].qty} shares` : ` · ${positions.length} positions`}
 </div>
 <div style={{
 fontSize: '14px',
 color: '#e2e8f0',
 marginBottom: '24px'
 }}>
 Market
 </div>
 <div style={{
 fontSize: '13px',
 color: '#94a3b8',
 marginBottom: '28px'
 }}>
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
 <span style={{
 fontSize: '18px',
 fontWeight: '700',
 color: '#ffffff'
 }}>
 {positions.length === 1
 ? `Sell ${positions[0].symbol}`
 : `Sell Selected (${positions.length})`}
 </span>
 <button
 onClick={onClose}
 style={{
 background: 'none',
 border: 'none',
 color: '#e2e8f0',
 fontSize: '22px',
 cursor: 'pointer',
 lineHeight: 1,
 padding: '0 4px'
 }}
 >×</button>
 </div>

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
 <div style={{
 fontSize: '16px',
 fontWeight: '700',
 color: '#ffffff'
 }}>
 {pos.symbol}
 </div>
 <div style={{
 fontSize: '12px',
 color: '#e2e8f0',
 marginTop: '3px'
 }}>
 {pos.qty} shares
 </div>
 </div>
 <div style={{ textAlign: 'right' }}>
 <div style={{
 fontSize: '16px',
 fontWeight: '600',
 color: '#ffffff'
 }}>
 ~${(pos.qty * pos.currentPrice)
 .toLocaleString(undefined,
 { minimumFractionDigits: 2 })}
 </div>
 <div style={{
 fontSize: '12px',
 color: '#e2e8f0',
 marginTop: '3px'
 }}>
 All shares · Market
 </div>
 </div>
 </div>
 ))}
 </div>

 {/* FOOTER */}
 <div style={{
 padding: '16px 20px',
 borderTop: '1px solid #2a3448'
 }}><div style={{
 fontSize: '12px',
 color: '#e2e8f0',
 textAlign: 'center',
 marginBottom: '6px'
 }}>
 All shares · Market order · Day
 </div>
 <div style={{
 fontSize: '20px',
 fontWeight: '700',
 color: '#22d3ee',
 textAlign: 'center',
 marginBottom: '16px'
 }}>
 Est. ${total.toLocaleString(undefined,
 { minimumFractionDigits: 2 })}
 </div>
 <div style={{ display: 'flex', gap: '12px' }}>
 <button
 onClick={onClose}
 style={{
 flex: 1,
 padding: '14px',
 background: 'transparent',
 border: '1px solid #374151',
 borderRadius: '10px',
 color: '#94a3b8',
 fontSize: '14px',
 cursor: 'pointer'
 }}
 >
 Cancel
 </button>
 <button
 onClick={() => setSubmitted(true)}
 style={{
 flex: 1,
 padding: '14px',
 background: '#ef4444',
 border: 'none',
 borderRadius: '10px',
 color: '#ffffff',
 fontSize: '14px',
 fontWeight: '600',
 cursor: 'pointer'
 }}
 >
 Confirm Sell
 </button>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 )
}
