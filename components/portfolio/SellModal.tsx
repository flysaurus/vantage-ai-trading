'use client'
import { useEffect } from 'react'

interface Position {
 symbol: string
 qty: number
 currentPrice: number
}

interface SellModalProps {
 positions: Position[]
 onClose: () => void
}

export default function SellModal({ positions, onClose }: SellModalProps) {
 const total = positions.reduce((s, p) => s + p.qty * p.currentPrice, 0)

 useEffect(() => {
 document.body.style.overflow = 'hidden'
 return () => { document.body.style.overflow = '' }
 }, [])

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
 padding: '20px'
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
 color: '#64748b',
 fontSize: '22px',
 cursor: 'pointer',
 lineHeight: 1,
 padding: '0 4px'
 }}
 >×</button>
 </div>

 {/* STOCK LIST */}
 <div style={{ overflowY: 'auto', flex: 1 }}>
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
 color: '#64748b',
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
 color: '#64748b',
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
 color: '#64748b',
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
 onClick={onClose}
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
 </div>
 </div>
 )
}
