'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export default function BrokerConnectionHelp() {
  const router = useRouter();

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
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
            How to Connect Your Broker
          </h1>
          <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 32px', lineHeight: 1.6 }}>
            Vantage connects to your broker through SnapTrade&apos;s secure OAuth flow.
            Here&apos;s how it works and what you need to know.
          </p>

          {/* ─── How It Works ──────────────────────────────────── */}
          <div style={{
            background: '#0a0e27',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '24px 20px',
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 4px', color: '#f1f5f9' }}>
              🔗 How the OAuth Connection Works
            </h2>
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 20px', lineHeight: 1.5 }}>
              You authenticate directly with your broker — Vantage never sees your password
              or trading credentials.
            </p>

            <Step title="1. Start the Connection">
              <li>Go to <strong>Settings → Broker Connections</strong> in Vantage</li>
              <li>Tap <strong>Connect Broker</strong></li>
              <li>You will be redirected to SnapTrade to begin the OAuth flow</li>
            </Step>

            <Step title="2. Choose Your Broker">
              <li>Select your broker from SnapTrade&apos;s list</li>
              <li>Supported: Alpaca, Robinhood, Schwab, Fidelity, E*TRADE, and more</li>
              <li>You&apos;ll be taken to your broker&apos;s official login page</li>
            </Step>

            <Step title="3. Log In & Approve">
              <li>Log in using your broker&apos;s normal credentials — just like you do on their app</li>
              <li>Your broker will ask you to approve the connection. Read the permissions carefully.</li>
              <li>By default, Vantage requests <strong>read-only access</strong> — we can see your portfolio but cannot trade</li>
            </Step>

            <Step title="4. Return to Vantage">
              <li>After approval, you will be automatically redirected back to Vantage</li>
              <li>Your portfolio and order history will begin loading immediately</li>
            </Step>

            <div style={{
              background: 'rgba(6, 182, 212, 0.06)',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              borderRadius: 8,
              padding: '14px 16px',
              marginTop: 8,
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#06b6d4', marginBottom: 6 }}>
                ⚡ Quick Tips
              </div>
              <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
                <li>You never need to generate or paste API keys</li>
                <li>If you change your broker password, no need to update anything in Vantage</li>
                <li>You can revoke access at any time from your broker&apos;s dashboard</li>
              </ul>
            </div>
          </div>

          {/* ─── Supported Brokers ───────────────────────────────── */}
          <div style={{
            background: '#0a0e27',
            border: '1px solid #1e293b',
            borderRadius: 12,
            padding: '24px 20px',
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 16px', color: '#f1f5f9' }}>
              📊 Supported Brokers
            </h2>
            <ul style={{ fontSize: 13, lineHeight: 2.0, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
              <li><strong style={{ color: '#f1f5f9' }}>Alpaca</strong> — paper & live trading</li>
              <li>Robinhood</li>
              <li>Charles Schwab</li>
              <li>Fidelity</li>
              <li>E*TRADE</li>
              <li>TD Ameritrade</li>
              <li>Interactive Brokers</li>
              <li>And more — see SnapTrade&apos;s full list during connection</li>
            </ul>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '12px 0 0', lineHeight: 1.5 }}>
              Availability varies. If your broker isn&apos;t listed, check back — we add new
              integrations regularly.
            </p>
          </div>

          {/* ─── SECURITY ─────────────────────────────────── */}
          <div style={{
            background: 'rgba(6, 182, 212, 0.04)',
            border: '1px solid rgba(6, 182, 212, 0.15)',
            borderRadius: 10,
            padding: '16px 18px',
            marginBottom: 16,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#06b6d4', marginBottom: 8 }}>
              🔐 Your Security
            </div>
            <ul style={{ fontSize: 12, lineHeight: 1.8, paddingLeft: 18, margin: 0, color: '#cbd5e1' }}>
              <li><strong>Credentials never touch our servers</strong> — you log in through your broker directly</li>
              <li>Read-only by default — we can see holdings, not trade or move money</li>
              <li>Revocable at any time from Vantage or your broker dashboard</li>
              <li>No API keys to generate, store, or leak</li>
            </ul>
          </div>

          <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
            Read our{' '}
            <a href="/security" style={{ color: '#06b6d4' }}>Security page</a>
            {' '}for full details on how your data is protected.
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
