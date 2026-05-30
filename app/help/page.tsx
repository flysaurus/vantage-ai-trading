'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { HelpCircle, BookOpen, Key, MessageCircle, ExternalLink, ChevronRight, X } from 'lucide-react';

// ─── Page ────────────────────────────────────────────────────
export default function HelpPage() {
  const router = useRouter();

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
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <HelpCircle size={18} style={{ color: '#8b5cf6' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Help & Support</h1>
            </div>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
              <X size={20} />
            </button>
          </div>

          {/* Quick Links */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Quick Links
            </div>
            <div
              onClick={() => router.push('/help/broker-keys')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Key size={15} style={{ color: '#f59e0b' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Broker API Keys</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>How to get API keys for Alpaca & Tastytrade</div>
                </div>
              </div>
              <ChevronRight size={14} style={{ color: '#475569' }} />
            </div>
            <div
              onClick={() => router.push('/security')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12, marginBottom: 8,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BookOpen size={15} style={{ color: '#06b6d4' }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Security</div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>How your data and credentials are protected</div>
                </div>
              </div>
              <ChevronRight size={14} style={{ color: '#475569' }} />
            </div>
          </div>

          {/* Getting Started */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Getting Started
            </div>
            <div style={{
              padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
              fontSize: 12, color: '#94a3b8', lineHeight: 1.7,
            }}>
              <p style={{ margin: '0 0 8px' }}>
                <strong style={{ color: '#e2e8f0' }}>1. Pick your investor style</strong><br />
                During signup, choose the investing philosophy that matches your approach. This determines your demo portfolio and AI recommendations.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong style={{ color: '#e2e8f0' }}>2. Connect your broker</strong><br />
                Add your Alpaca or Tastytrade API keys in Settings. Vantage encrypts them before storage — they never touch a browser.
              </p>
              <p style={{ margin: '0 0 8px' }}>
                <strong style={{ color: '#e2e8f0' }}>3. Explore your dashboard</strong><br />
                Portfolio, AI analysis, orders, and trade history — all streamed live from your broker. Use demo mode until you're ready to connect.
              </p>
              <p style={{ margin: 0 }}>
                <strong style={{ color: '#e2e8f0' }}>4. Set up strategies</strong><br />
                Configure DCA, rebalancing, momentum, or mean-reversion strategies. Vantage monitors and executes based on your rules.
              </p>
            </div>
          </div>

          {/* FAQ */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              FAQ
            </div>
            <FaqItem q="Is my broker login safe?" a="Yes. Vantage uses API keys (not your broker password) and encrypts them with AES-256-GCM using a per-user key before storage. Keys are decrypted server-side only — they never reach your browser." />
            <FaqItem q="Can Vantage move my money?" a="Vantage can place trades through your broker's API, but all deposits and withdrawals happen on your broker's platform. Vantage never has access to your bank account." />
            <FaqItem q="What brokers are supported?" a="Alpaca and Tastytrade are fully supported. Schwab, Robinhood, and IBKR are coming soon via OAuth." />
            <FaqItem q="Can I use Vantage without a broker?" a="Yes! All features work in demo mode with a mock portfolio based on your investor style. Real market prices are fetched from Finnhub." />
          </div>

          {/* Contact */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              Contact
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: 14, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 12,
            }}>
              <MessageCircle size={15} style={{ color: '#06b6d4' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#94a3b8' }}>Questions or feedback? Send us an email.</div>
              </div>
              <a
                href="mailto:mparikhds@gmail.com?subject=Vantage%20Support"
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '8px 14px', borderRadius: 8,
                  background: '#06b6d4', color: '#fff', fontSize: 12, fontWeight: 600,
                  textDecoration: 'none', flexShrink: 0,
                }}
              >
                Email Support
                <ExternalLink size={10} />
              </a>
            </div>
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 10, color: '#64748b' }}>mparikhds@gmail.com</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 14px', background: '#0f172a', border: '1px solid #1e293b',
          borderRadius: open ? '12px 12px 0 0' : 12, cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500, flex: 1 }}>{q}</span>
        <ChevronRight size={14} style={{ color: '#475569', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
      </div>
      {open && (
        <div style={{
          padding: '12px 14px', background: '#0f172a', border: '1px solid #1e293b',
          borderTop: 'none', borderRadius: '0 0 12px 12px',
          fontSize: 11, color: '#94a3b8', lineHeight: 1.7,
        }}>
          {a}
        </div>
      )}
    </div>
  );
}
