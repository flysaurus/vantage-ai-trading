'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Shield, X } from 'lucide-react';
import BackButton from '@/components/shared/BackButton';

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
          <BackButton
            tab="settings"
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#94a3b8',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'inherit',
              marginBottom: 24,
            }}
          >
            <X size={14} />
            Close
          </BackButton>

          {/* Page Title */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Shield size={22} style={{ color: '#06b6d4' }} />
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#f1f5f9' }}>
                How We Protect Your Broker Data
              </h1>
            </div>
            <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
              We take the security of your financial accounts seriously. Vantage uses
              SnapTrade OAuth — you log in directly with your broker, and we never see your
              password or trading credentials.
            </p>
          </div>

          <Section title="When You Connect">
            <p>
              <strong>You authenticate with your broker directly.</strong> When you link your
              account, you&apos;re redirected to your broker&apos;s own login page — just like
              logging into their app or website. Vantage never sees your username, password,
              or multi-factor codes.
            </p>
            <p>
              After you approve the connection, your broker issues a secure access token
              through SnapTrade. That token is what our servers use to read your portfolio
              and data. You can revoke this access at any time from either Vantage or your
              broker&apos;s settings.
            </p>
            <p>
              <strong>Read-only by default.</strong> Connections are set up with the minimum
              permissions needed. We can see your holdings and order history, but cannot
              place trades or move money unless you explicitly enable trading.
            </p>
          </Section>

          <Section title="What We Can Access">
            <p>
              We only access what you explicitly allow through the OAuth permission
              flow, and only when you ask us to. There are no raw API keys for anyone
              to lose, leak, or abuse.
            </p>
            <NoList
              items={[
                'Access your account without an active OAuth token that you have approved',
                'See your broker login credentials — they were never shared with us',
                'Share or transfer your data to any third party',
                'Place trades or move money without your explicit action',
              ]}
            />
          </Section>

          <Section title="When You Disconnect">
            <p>
              Disconnecting revokes your OAuth token immediately. Your broker closes the
              access window and we permanently delete all associated data from our database.
              If you reconnect later, you go through the same secure OAuth flow — there is
              no archive, no backup, and no cached credentials to recover.
            </p>
          </Section>

          <Section title="Your Credentials Never Touch Our Servers">
            <p>At no point in the connection flow do we ever receive:</p>
            <NoList
              items={[
                'Your broker username or password',
                'API keys or secret keys generated in your broker dashboard',
                'Multi-factor authentication codes or recovery tokens',
                'Any credentials that could be used to independently access your account',
              ]}
            />
            <p>
              The OAuth access token stored on our servers is scoped, time-limited, and
              revocable. Even if someone gained access to our database, they could not
              obtain credentials to log into your broker account.
            </p>
          </Section>

          <Section title="What You Can Do">
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                <strong style={{ color: '#f1f5f9' }}>Disconnect at any time</strong> from
                Settings with one tap — access is revoked immediately
              </li>
              <li style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                <strong style={{ color: '#f1f5f9' }}>Use paper trading</strong> to
                test the platform without exposing a funded account
              </li>
              <li style={{ marginBottom: 8, fontSize: 13, color: '#cbd5e1', lineHeight: 1.7 }}>
                <strong style={{ color: '#f1f5f9' }}>Revoke access from your broker</strong>
                {" "}— you can also manage or remove Vantage from your broker accounts
              </li>
            </ul>
          </Section>

          <Section title="Our Commitment">
            <p>
              Security isn&apos;t a feature — it&apos;s the foundation. We&apos;ve designed the system so
              that your broker credentials never enter our infrastructure. We only hold the
              minimum data needed to show you your portfolio.
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
