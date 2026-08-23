'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Layers } from 'lucide-react';

// ─── Permanent FIFO reference article (Settings → Help) ──────
// Link-only, never proactive. This page is only reachable via a
// deliberate tap in Help & Support — it is never surfaced as a
// popup/explainer/nudge anywhere in the app.
// ──────────────────────────────────────────────────────────────

export default function FIFOReferencePage() {
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(34,211,238,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Layers size={18} style={{ color: '#22d3ee' }} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>FIFO &amp; Cost Basis</h1>
            </div>
            <button onClick={() => router.back()} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}>
              <ArrowLeft size={20} />
            </button>
          </div>

          {/* Intro */}
          <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7, margin: '0 0 20px' }}>
            This article explains how Vantage tracks your lots and decides which
            shares get sold when you place a sell order.
          </p>

          {/* Section */}
          <Section title="What is a lot?">
            <p style={body}>
              A <strong style={{ color: '#e2e8f0' }}>lot</strong> is a group of shares you
              bought in a single purchase, each with its own purchase date and price.
              If you buy the same stock on three different days, you hold three lots —
              even though your position shows as one combined number of shares.
            </p>
          </Section>

          <Section title="How Vantage sells (FIFO)">
            <p style={body}>
              Vantage uses <strong style={{ color: '#e2e8f0' }}>FIFO — First In, First Out</strong>.
              When you sell, your <strong style={{ color: '#f0b73f' }}>oldest shares are sold first</strong>.
              This is the default at most brokers and determines which lots are used to
              calculate your realized gain or loss for tax purposes.
            </p>
            <p style={body}>
              Before you confirm any sell, Vantage shows you exactly which lots
              (and their purchase dates) the sale will draw from — never a vague
              &quot;N shares&quot; summary.
            </p>
          </Section>

          <Section title="Realized gain & loss">
            <p style={body}>
              Realized P/L is calculated per lot as the difference between the sale
              price and each lot&apos;s purchase price, summed across the lots that were
              actually sold. Because older lots usually have a different cost basis
              than newer ones, FIFO can change the realized amount versus an
              average-cost estimate.
            </p>
          </Section>

          <Section title="Selling outside Vantage">
            <p style={body}>
              If you sell shares directly on your broker&apos;s site or app, Vantage detects
              the fill on its next sync and updates your lot ledger the same way — oldest
              shares first — so your remaining lots always reflect reality.
            </p>
          </Section>

          <Section title="Where to see your lots">
            <p style={body}>
              Open any position card and expand it — the <strong style={{ color: '#e2e8f0' }}>Lots &amp; Cost Basis</strong>{' '}
              section lists every active lot with its purchase date, quantity, price, and
              unrealized gain/loss. A cyan <strong style={{ color: '#22d3ee' }}>&quot;N lots&quot;</strong> badge
              appears on the card whenever you hold two or more.
            </p>
          </Section>

          <p style={{ fontSize: 10, color: '#64748b', lineHeight: 1.6, margin: '20px 0 0' }}>
            Vantage supports FIFO cost-basis only. Other methods (LIFO, average cost,
            specific-lot selection) are not currently available.
          </p>
        </div>
      </div>
    </div>
  );
}

const body: React.CSSProperties = {
  fontSize: 12,
  color: '#94a3b8',
  lineHeight: 1.7,
  margin: 0,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#e2e8f0', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
