'use client';

import React from 'react';
import Link from 'next/link';

export default function BrokerKeysHelp() {
  return (
    <div style={{
      minHeight: '100dvh',
      background: '#0a0e27',
      color: '#e2e8f0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      padding: '40px 20px',
      overflowY: 'auto',
    }}>
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        {/* Back link */}
        <Link
          href="/"
          style={{
            color: '#06b6d4',
            textDecoration: 'none',
            fontSize: 14,
            display: 'inline-block',
            marginBottom: 32,
          }}
        >
          ← Back to Dashboard
        </Link>

        <h1 style={{
          fontSize: 28,
          fontWeight: 700,
          margin: '0 0 8px',
          background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          How to Get Your Broker API Keys
        </h1>
        <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 40px', lineHeight: 1.6 }}>
          Follow the steps below for your broker. API keys let Vantage connect to your
          account securely — you control exactly what permissions they have.
        </p>

        {/* ─── ALPACA ────────────────────────────────────────── */}
        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '32px 28px',
          marginBottom: 32,
        }}>
          <h2 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: '0 0 6px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span>🦙</span> Alpaca Markets
          </h2>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 24px' }}>
            Commission-free stock trading with a developer-friendly API. Paper trading
            is free and lets you test without real money.
          </p>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#06b6d4' }}>
              Step 1 — Create an Alpaca Account
            </h3>
            <ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Go to <a href="https://app.alpaca.markets/signup" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>app.alpaca.markets/signup</a></li>
              <li>Fill in your details and create your account</li>
              <li>Verify your email address</li>
            </ol>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#06b6d4' }}>
              Step 2 — Generate API Keys
            </h3>
            <ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Log in and go to your dashboard</li>
              <li>
                For <strong>paper trading</strong> (test with fake money):{' '}
                <a href="https://app.alpaca.markets/paper/dashboard/overview" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  Paper Dashboard →
                </a>
              </li>
              <li>
                For <strong>live trading</strong> (real money):{' '}
                <a href="https://app.alpaca.markets/live/dashboard/overview" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  Live Dashboard →
                </a>
              </li>
              <li>In the left sidebar, click <strong>API Keys</strong></li>
              <li>Click <strong>Generate New Key</strong></li>
              <li>Give it a name (e.g., "Vantage")</li>
              <li>
                <strong>Copy your Key ID and Secret Key immediately</strong> — the
                secret is shown only once
              </li>
            </ol>
          </div>

          <div style={{
            background: 'rgba(6, 182, 212, 0.08)',
            border: '1px solid rgba(6, 182, 212, 0.25)',
            borderRadius: 10,
            padding: '16px 20px',
            marginBottom: 20,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: '#06b6d4' }}>
              ⚡ Quick Tips
            </h3>
            <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Paper and live use <strong>separate keys</strong> — generate them in the correct dashboard</li>
              <li>Start with <strong>paper trading</strong> to test Vantage risk-free</li>
              <li>Your keys look like: <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>PK...</code> and <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>SK...</code></li>
            </ul>
          </div>

          <div style={{
            borderTop: '1px solid #1e293b',
            paddingTop: 16,
            fontSize: 12,
            color: '#64748b',
          }}>
            📚 Official docs:{' '}
            <a href="https://docs.alpaca.markets" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
              docs.alpaca.markets
            </a>
          </div>
        </div>

        {/* ─── TASTYTRADE ────────────────────────────────────── */}
        <div style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '32px 28px',
          marginBottom: 32,
        }}>
          <h2 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: '0 0 6px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <span>🍝</span> Tastytrade
          </h2>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 24px' }}>
            Options and futures trading platform with a robust API. Sandbox environment
            available for testing.
          </p>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#06b6d4' }}>
              Step 1 — Create a Tastytrade Account
            </h3>
            <ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Go to <a href="https://tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>tastytrade.com</a></li>
              <li>Click <strong>Open an Account</strong> and complete registration</li>
              <li>For the sandbox (test environment), you do not need a funded account</li>
            </ol>
          </div>

          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px', color: '#06b6d4' }}>
              Step 2 — Generate API Credentials
            </h3>
            <ol style={{ fontSize: 14, lineHeight: 2, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Log in to{' '}
                <a href="https://manage.tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
                  manage.tastytrade.com
                </a>
              </li>
              <li>Go to <strong>My Profile → API</strong> (or Developer Settings)</li>
              <li>Click <strong>Generate API Token</strong></li>
              <li>You will receive an <strong>API Key</strong></li>
              <li>
                Your login credentials (email + password) combined with the API Key
                are used to authenticate API sessions
              </li>
            </ol>
          </div>

          <div style={{
            background: 'rgba(6, 182, 212, 0.08)',
            border: '1px solid rgba(6, 182, 212, 0.25)',
            borderRadius: 10,
            padding: '16px 20px',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: '#06b6d4' }}>
              ⚡ Quick Tips
            </h3>
            <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
              <li>Use the <strong>sandbox</strong> environment to test first</li>
              <li>Sandbox URL:{' '}
                <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
                  api.cert.tastyworks.com
                </code>
              </li>
              <li>Live URL:{' '}
                <code style={{ background: '#1e293b', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>
                  api.tastytrade.com
                </code>
              </li>
            </ul>
          </div>

          <div style={{
            borderTop: '1px solid #1e293b',
            paddingTop: 16,
            fontSize: 12,
            color: '#64748b',
            marginTop: 20,
          }}>
            📚 Official docs:{' '}
            <a href="https://developer.tastytrade.com" target="_blank" rel="noopener" style={{ color: '#06b6d4' }}>
              developer.tastytrade.com
            </a>
          </div>
        </div>

        {/* ─── SECURITY NOTE ─────────────────────────────────── */}
        <div style={{
          background: 'rgba(239, 68, 68, 0.06)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 40,
        }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 8px', color: '#fca5a5' }}>
            🔐 Important Security Reminders
          </h3>
          <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20, margin: 0, color: '#cbd5e1' }}>
            <li>Never share your API keys with anyone</li>
            <li>Use the minimum permissions needed — Vantage only needs trading and
              market data access</li>
            <li>Consider creating dedicated API keys just for Vantage so you can revoke
              them without affecting other services</li>
            <li>If you suspect your keys have been compromised, revoke them immediately
              in your broker dashboard and generate new ones</li>
          </ul>
        </div>

        <p style={{ fontSize: 12, color: '#475569', textAlign: 'center' }}>
          Need help? Check your broker's support documentation or reach out to us.
        </p>
      </div>
    </div>
  );
}
