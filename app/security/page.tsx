'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Shield, ArrowLeft } from 'lucide-react';

export default function SecurityPage() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100dvh',
      overflowY: 'auto',
      padding: '16px 16px 80px',
      maxWidth: 700,
      margin: '0 auto',
    }}>
      {/* Back Button */}
      <button
        onClick={() => router.back()}
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
        <ArrowLeft size={14} />
        Back
      </button>

      {/* Page Title */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <Shield size={24} style={{ color: '#06b6d4' }} />
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>
            How Vantage Protects Your Broker Keys
          </h1>
        </div>
        <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
          We take the security of your financial accounts seriously. Here&apos;s exactly what happens
          when you connect your broker and how your information is protected.
        </p>
      </div>

      {/* What Happens When You Enter Your Keys */}
      <Section title="What Happens When You Enter Your Keys">
        <p>
          <strong>1. Encryption happens immediately.</strong> The moment you submit the form, your broker
          credentials are scrambled into an unreadable format using industry-standard encryption.
          This happens before the data leaves your device — no plain text ever travels over the
          internet.
        </p>
        <p>
          <strong>2. Your connection is already secure.</strong> All communication between your browser and
          our servers uses HTTPS, the same encryption that protects online banking and payment
          systems. Even before our application-level encryption kicks in, the transport layer
          prevents anyone from intercepting your data in transit.
        </p>
        <p>
          <strong>3. Storage: locked, not hidden.</strong> Your encrypted credentials are stored in a way
          that requires your active account session to unlock. Without both parts — your
          authenticated session and our server-side security — the stored data is useless.
          Think of it as a safety deposit box that requires two keys to open.
        </p>
      </Section>

      {/* What We Do With Your Keys */}
      <Section title="What We Do With Your Keys">
        <p>
          We use them for exactly what you ask us to do, and nothing else.
        </p>
        <p>
          When you check your portfolio, place a trade, or view your positions, our servers
          temporarily decrypt your credentials, make the request to your broker, and immediately
          discard the decrypted copy. This happens in a fraction of a second, entirely in server
          memory — your keys are never written to disk, logs, or any persistent storage in
          decrypted form.
        </p>
        <NoList
          items={[
            'Use your keys for any purpose other than what you explicitly initiate in the app',
            'Share, sell, or transfer your credentials to any third party',
            'Store decrypted copies anywhere',
            'Access your account without your active session',
          ]}
        />
      </Section>

      {/* What Happens When You Disconnect */}
      <Section title="What Happens When You Disconnect">
        <p>
          Disconnecting your broker is a hard delete, not a soft hide. The encrypted data is
          permanently destroyed with no recovery path. If you reconnect later, you&apos;ll need to
          enter your keys again from scratch. There is no archive, no backup, and no way for
          us — or anyone else — to recover deleted credentials.
        </p>
      </Section>

      {/* Where Your Keys Never Go */}
      <Section title="Where Your Keys Never Go">
        <p>
          Your raw broker credentials are never:
        </p>
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
          If someone gained access to your browser, your phone, or even our database, your
          broker credentials would not be accessible.
        </p>
      </Section>

      {/* What You Can Do */}
      <Section title="What You Can Do">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li style={{ marginBottom: 8 }}>
            <strong>Disconnect at any time</strong> from Settings → Broker with one tap
          </li>
          <li style={{ marginBottom: 8 }}>
            <strong>Use paper trading</strong> (available with Alpaca) to test the platform without
            exposing a funded account
          </li>
          <li style={{ marginBottom: 0 }}>
            <strong>Create dedicated API keys</strong> in your broker&apos;s settings with only the
            permissions you need (trading, read-only, etc.)
          </li>
        </ul>
      </Section>

      {/* Our Commitment */}
      <Section title="Our Commitment">
        <p>
          Security isn&apos;t a feature — it&apos;s the foundation. We&apos;ve designed the system so that
          even we cannot access your broker keys independently. The encryption happens on your
          side, the decryption requires your active session, and the storage is worthless without
          both.
        </p>
        <p>
          If you have questions about our security practices or want to report a concern,
          reach out to us directly.
        </p>
      </Section>

      <style>{`
        p {
          font-size: 13px;
          color: #cbd5e1;
          line-height: 1.7;
          margin: 0 0 14px;
        }
        p strong {
          color: #f1f5f9;
        }
        li {
          font-size: 13px;
          color: #cbd5e1;
          line-height: 1.7;
        }
        li strong {
          color: #f1f5f9;
        }
      `}</style>
    </div>
  );
}

// ─── Section Component ────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{
        fontSize: 17,
        fontWeight: 700,
        color: '#f1f5f9',
        margin: '0 0 14px',
        paddingBottom: 8,
        borderBottom: '1px solid #1e293b',
      }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

// ─── "We Never" List ──────────────────────────────────────────
function NoList({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: '0 0 14px', paddingLeft: 18 }}>
      {items.map((item, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: '#f87171' }}>We never </span>
          <span style={{ color: '#cbd5e1' }}>{item}</span>
        </li>
      ))}
    </ul>
  );
}
