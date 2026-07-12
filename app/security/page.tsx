'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Shield, X } from 'lucide-react';

export default function SecurityPage() {
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
          {/* Close Button */}
          <button
            onClick={() => router.push('/?tab=settings')}
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

          {/* Page Title */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Shield size={22} style={{ color: '#06b6d4' }} />
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#f1f5f9' }}>
                How We Protect Your Broker Keys
              </h1>
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
              We take the security of your financial accounts seriously. Here&apos;s exactly what
              happens when you connect your broker and how your information is protected.
            </p>
          </div>

          <Section title="When You Enter Your Keys">
            <p>
              <strong>Encryption happens immediately.</strong> Your credentials are scrambled into
              an unreadable format using industry-standard encryption before they leave your
              device. No plain text ever travels over the internet.
            </p>
            <p>
              <strong>Your connection is already secure.</strong> All communication uses HTTPS,
              the same encryption that protects online banking. Even before our
              application-level encryption, the transport layer prevents interception.
            </p>
            <p>
              <strong>Storage: locked, not hidden.</strong> Your encrypted credentials require your
              active account session to unlock. Without both parts — your authenticated session
              and our server-side security — the stored data is useless.
            </p>
          </Section>

          <Section title="What We Do With Your Keys">
            <p>
              We use them for exactly what you ask us to do, and nothing else.
            </p>
            <p>
              When you check your portfolio or place a trade, our servers temporarily decrypt
              your credentials, make the request to your broker, and immediately discard the
              decrypted copy. This happens in a fraction of a second in server memory — your
              keys are never written to disk, logs, or any persistent storage.
            </p>
            <NoList
              items={[
                'Use your keys for anything other than what you explicitly initiate',
                'Share, sell, or transfer your credentials to any third party',
                'Store decrypted copies anywhere',
                'Access your account without your active session',
              ]}
            />
          </Section>

          <Section title="When You Disconnect">
            <p>
              Disconnecting is a hard delete, not a soft hide. The encrypted data is
              permanently destroyed with no recovery path. If you reconnect later, you&apos;ll
              need to enter your keys again from scratch. There is no archive, no backup, and
              no way for us — or anyone else — to recover deleted credentials.
            </p>
          </Section>

          <Section title="Where Your Keys Never Go">
            <p>Your raw broker credentials are never:</p>
            <NoList
              items={[
                'Stored in your browser\'s local storage or cookies',
                'Sent back to your browser after initial submission',
                'Included in error logs, analytics, or monitoring systems',
                'Accessible to our support team or any human operator',
                'Backed up in recoverable form',
              ]}
            />
            <p>
              If someone gained access to your browser, your phone, or even our database,
              your broker credentials would not be accessible.
            </p>
          </Section>

          <Section title="What You Can Do">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                <strong style={{ color: '#f1f5f9' }}>Disconnect at any time</strong> from
                Settings with one tap
              </li>
              <li style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                <strong style={{ color: '#f1f5f9' }}>Use paper trading</strong> (Alpaca) to
                test the platform without exposing a funded account
              </li>
              <li>
                <strong style={{ color: '#f1f5f9' }}>Create dedicated API keys</strong> in
                your broker&apos;s settings with only the permissions you need
              </li>
            </ul>
          </Section>

          <Section title="Our Commitment">
            <p>
              Security isn&apos;t a feature — it&apos;s the foundation. We&apos;ve designed the system so
              that even we cannot access your broker keys independently.
            </p>
            <p>
              If you have questions about our security practices or want to report a concern,
              reach out to us directly.
            </p>
          </Section>

          <style>{`
            p { font-size: 13px; color: #cbd5e1; line-height: 1.7; margin: 0 0 14px; }
            p strong { color: #f1f5f9; }
          `}</style>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h2 style={{
        fontSize: 15,
        fontWeight: 700,
        color: '#f1f5f9',
        margin: '0 0 12px',
        paddingBottom: 8,
        borderBottom: '1px solid #1e293b',
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function NoList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
          <span style={{ fontWeight: 700, color: '#f87171' }}>We never </span>
          {item}
        </li>
      ))}
    </ul>
  );
}
