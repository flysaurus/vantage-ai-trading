'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { CreditCard, ExternalLink, DollarSign, Receipt, Shield, X } from 'lucide-react';

// ─── Inner Page ──────────────────────────────────────────────
function AccountPageInner() {
  const router = useRouter();
  const { isConnected, brokerId, accountPreview } = useBroker();

  const brokerName = brokerId === 'alpaca' ? 'Alpaca' : brokerId === 'tastytrade' ? 'Tastytrade' : null;
  const brokerUrl = brokerId === 'alpaca'
    ? 'https://app.alpaca.markets'
    : brokerId === 'tastytrade'
    ? 'https://trade.tastytrade.com'
    : null;

  const brokerSections = brokerId === 'alpaca' ? [
    { label: 'Deposit Funds', url: 'https://app.alpaca.markets/dashboard', desc: 'Transfer money into your brokerage account' },
    { label: 'Withdraw Funds', url: 'https://app.alpaca.markets/dashboard', desc: 'Move money from your brokerage account to your bank' },
    { label: 'Tax Documents', url: 'https://app.alpaca.markets/tax-documents', desc: '1099 forms, annual statements, and trade confirmations' },
  ] : brokerId === 'tastytrade' ? [
    { label: 'Deposit Funds', url: 'https://trade.tastytrade.com/accounts/funding', desc: 'Transfer money into your brokerage account' },
    { label: 'Withdraw Funds', url: 'https://trade.tastytrade.com/accounts/funding', desc: 'Move money from your brokerage account to your bank' },
    { label: 'Tax Documents', url: 'https://trade.tastytrade.com/accounts/tax', desc: 'Annual tax forms and trade confirmations' },
  ] : [];

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      padding: 16, paddingBottom: 32,
      background: '#0a0e27',
      overflowY: 'auto', WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{
          background: '#0f172a', border: '1px solid #334155',
          borderRadius: 16, padding: '32px 24px',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(34,197,94,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CreditCard size={18} style={{ color: '#22c55e' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Account & Funding</h1>
            </div>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {/* Broker Status */}
          <div style={{
            background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, padding: 16, marginBottom: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: isConnected ? '#22c55e' : '#64748b', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {isConnected && brokerName ? `Connected to ${brokerName}` : 'No broker connected'}
              </span>
            </div>
            {isConnected && accountPreview && (
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Account: {accountPreview.id || 'N/A'} · Equity: ${accountPreview.equity.toLocaleString()}
              </div>
            )}
            {!isConnected && (
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Connect a broker from Settings to enable funding and tax document access.
              </div>
            )}
          </div>

          {isConnected && brokerUrl && (
            <>
              <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Broker Actions
              </div>
              {brokerSections.map((section, i) => (
                <a
                  key={i}
                  href={section.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: 14,
                    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
                    marginBottom: 8, textDecoration: 'none', color: 'inherit',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{section.label}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{section.desc}</div>
                  </div>
                  <ExternalLink size={14} style={{ color: '#475569', flexShrink: 0 }} />
                </a>
              ))}

              <a
                href={brokerUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: 12, borderRadius: 10, marginTop: 8,
                  background: '#1e293b', border: '1px solid #334155',
                  textDecoration: 'none', color: '#06b6d4', fontSize: 13, fontWeight: 600,
                }}
              >
                Open {brokerName} Dashboard
                <ExternalLink size={12} />
              </a>
            </>
          )}

          {/* Info */}
          <div style={{ marginTop: 20, padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Shield size={14} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 12, fontWeight: 600 }}>Important</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.6 }}>
              Vantage is a trading dashboard — not a broker. All deposits, withdrawals, and account management
              happen on your broker's platform. Vantage securely stores your API keys to display portfolio
              data and place trades, but never touches your funds directly.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AccountPage() {
  return (
    <BrokerProvider>
      <AccountPageInner />
    </BrokerProvider>
  );
}
