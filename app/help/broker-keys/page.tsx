'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export default function BrokerKeysHelp() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100dvh',
      padding: 16,
      paddingBottom: 32,
      background: '#0a0e27',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
    }}>
      <div style={{ maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '32px 24px',
        }}>
          {/* Close button */}
          <button
            onClick={() => router.push('/')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#94a3b8',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: 24,
            }}
          >
            <X size={14} />
            Close
          </button>

          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px', color: '#f1f5f9' }}>
            How to Get Your Broker API Keys
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 32px', lineHeight: 1.6 }}>
            Follow the steps below for your broker. API keys let Vantage connect to your
            account securely — you control exactly what permissions they have.
          </p>

          {/* ─── ALPACA ────────────────────────────────────────── */}
          <div style={{
            background: '#0a0e27',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '24px 20px',
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: '#f1f5f9' }}>
              🦙 Alpaca Markets
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
              Commission-free stock trading with a developer-friendly API. Paper trading
              is free and lets you test without real money.
            </p>

            <Step title="Create an Account">
              <li>Go to{' '}
                <a href="https://app.alpaca.markets/signup" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  app.alpaca.markets/signup
                </a>
              </li>
              <li>Fill in your details and create your account</li>
              <li>Verify your email address</li>
            </Step>

            <Step title="Generate API Keys">
              <li>Log in and go to your dashboard</li>
              <li>
                <strong>Paper trading</strong> (test with fake money):{' '}
                <a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  Paper Dashboard →
                </a>
              </li>
              <li>
                <strong>Live trading</strong> (real money):{' '}
                <a href="https://app.alpaca.markets/live/dashboard/overview" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  Live Dashboard →
                </a>
              </li>
              <li>In the left sidebar, click <strong>API Keys</strong></li>
              <li>Click <strong>Generate New Key</strong></li>
              <li>Give it a name (e.g., "Vantage")</li>
              <li>Copy your Key ID and Secret Key immediately — the secret is shown only once</li>
            </Step>

            <div style={{
              background: 'rgba(6, 182, 212, 0.06)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#06b6d4', marginBottom: 6 }}>
                ⚡ Quick Tips
              </div>
              <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
                <li>Paper and live use <strong>separate keys</strong></li>
                <li>Start with <strong>paper trading</strong> to test risk-free</li>
                <li>Keys look like: <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>PK...</code> and <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>SK...</code></li>
              </ul>
            </div>

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14, marginTop: 16, fontSize: 12, color: '#64748b' }}>
              📚{' '}
              <a href="https://docs.alpaca.markets" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                docs.alpaca.markets
              </a>
            </div>
          </div>

          {/* ─── TASTYTRADE ────────────────────────────────────── */}
          <div style={{
            background: '#0a0e27',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '24px 20px',
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: '#f1f5f9' }}>
              🍝 Tastytrade
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
              Options and futures trading platform with a robust API. Sandbox environment
              available for testing.
            </p>

            <Step title="Create an Account">
              <li>Go to{' '}
                <a href="https://tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  tastytrade.com
                </a>
              </li>
              <li>Click Open an Account and complete registration</li>
              <li>For the sandbox, you do not need a funded account</li>
            </Step>

            <Step title="Generate API Credentials">
              <li>Log in to{' '}
                <a href="https://manage.tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  manage.tastytrade.com
                </a>
              </li>
              <li>Go to My Profile → API (or Developer Settings)</li>
              <li>Click Generate API Token</li>
              <li>You will receive an API Key</li>
              <li>Your login credentials + API Key authenticate API sessions</li>
            </Step>

            <div style={{
              background: 'rgba(6, 182, 212, 0.06)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              borderRadius: 8,
              padding: '14px 16px',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#06b6d4', marginBottom: 6 }}>
                ⚡ Quick Tips
              </div>
              <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
                <li>Use the <strong>sandbox</strong> environment to test first</li>
                <li>Sandbox: <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>api.cert.tastyworks.com</code></li>
                <li>Live: <code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>api.tastytrade.com</code></li>
              </ul>
            </div>

            <div style={{ borderTop: '1px solid #1e293b', paddingTop: 14, marginTop: 16, fontSize: 12, color: '#64748b' }}>
              📚{' '}
              <a href="https://developer.tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                developer.tastytrade.com
              </a>
            </div>
          </div>

          {/* ─── SECURITY NOTE ─────────────────────────────────── */}
          <div style={{
            background: 'rgba(239, 68, 68, 0.04)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            borderRadius: 10,
            padding: '16px 18px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>
              🔐 Important Security Reminders
            </div>
            <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
              <li>Never share your API keys with anyone</li>
              <li>Use the minimum permissions needed — Vantage only needs trading and market data</li>
              <li>Create dedicated API keys just for Vantage so you can revoke them easily</li>
              <li>If keys are compromised, revoke them immediately in your broker dashboard</li>
            </ul>
          </div>

          <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', margin: 0 }}>
            Need help? Check your broker&apos;s support documentation or reach out to us.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Step Component ─────────────────────────────────────────────
function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#06b6d4', marginBottom: 8 }}>
        {title}
      </div>
      <ol style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
        {children}
      </ol>
    </div>
  );
}
