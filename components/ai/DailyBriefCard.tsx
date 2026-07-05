'use client';

import { apiGet } from '@/lib/api-client';
import { useState, useEffect } from 'react';

// ── Reference design tokens (from vantage-pill-design.html) ──
const PILL_BG = 'rgba(255,255,255,0.05)';
const PILL_BORDER = 'rgba(255,255,255,0.08)';
const PILL_HOVER_BG = 'rgba(255,255,255,0.08)';
const CARD_BG = 'rgba(255,255,255,0.05)';
const CARD_BORDER_ACCENT = 'rgba(34,211,238,0.25)'; // cyan accent
const TEXT_SUBTLE = 'rgba(255,255,255,0.5)';
const TEXT_MUTED = 'rgba(255,255,255,0.3)';
const CHEVRON_COLOR = 'rgba(255,255,255,0.3)';
const BACKDROP_BLUR = 'blur(20px)';

const TAG_COLORS: Record<string, string> = {
  MARKET: '#22d3ee',      // accent/cyan
  PORTFOLIO: '#10b981',   // gain/green
  WATCH: '#f59e0b',       // warning/amber
  EARNINGS: '#a78bfa',    // purple
};

const TAG_BG: Record<string, string> = {
  MARKET: 'rgba(34,211,238,0.15)',
  PORTFOLIO: 'rgba(16,185,129,0.15)',
  WATCH: 'rgba(245,158,11,0.15)',
  EARNINGS: 'rgba(167,139,250,0.15)',
};

interface MarketSnapshot {
  sym: string;
  price: number;
  changePct: number;
}

interface MarketSummary {
  spy?: MarketSnapshot;
  qqq?: MarketSnapshot;
  iwm?: MarketSnapshot;
}

interface BriefData {
  content?: string | null;
  marketSummary?: MarketSummary;
  generatedAt?: string | null;
  cached?: boolean;
}

interface ParsedLine {
  label: string;
  text: string;
}

function parseBrief(content: string): ParsedLine[] {
  const lines = content.split('\n').filter((l) => l.trim());
  return lines
    .map((line) => {
      const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
      if (match) return { label: match[1].toUpperCase(), text: match[2].trim() };
      return { label: '', text: line.trim() };
    })
    .filter((l) => l.text);
}

function extractSummary(content: string): string {
  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    if (!/^(MARKET|PORTFOLIO|WATCH|EARNINGS):/i.test(line)) {
      const clean = line.replace(/^[-•*]\s*/, '').trim();
      const firstSentence = clean.split(/[.!?]\s/)[0].trim();
      if (firstSentence.length > 10) return firstSentence.length > 60 ? firstSentence.slice(0, 57) + '…' : firstSentence;
    }
  }
  for (const line of lines) {
    const match = line.match(/^(MARKET|PORTFOLIO|WATCH|EARNINGS):\s*(.+)/i);
    if (match) {
      const t = match[2].trim();
      return t.length > 60 ? t.slice(0, 57) + '…' : t;
    }
  }
  return 'Today\'s brief';
}

export default function DailyBriefCard() {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    apiGet(`/api/ai/daily-brief?tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      style={{ width: '14px', height: '14px', color: CHEVRON_COLOR }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  // ─── Loading skeleton ───
  if (loading) {
    return (
      <div style={{ padding: '0 16px' }}>
        <div style={{
          background: PILL_BG,
          border: `1px solid ${PILL_BORDER}`,
          borderRadius: '999px',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          backdropFilter: BACKDROP_BLUR,
        }}>
          <span style={{ fontSize: '18px' }}>🗞️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>Daily Brief</div>
            <div style={{ fontSize: '12px', color: TEXT_SUBTLE, marginTop: '1px' }}>Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const brief = data?.content;
  if (!brief) return null;

  const parsed = parseBrief(brief);
  const summary = extractSummary(brief);

  // ─── Collapsed pill ───
  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{
          background: PILL_BG,
          border: `1px solid ${PILL_BORDER}`,
          borderRadius: '16px',
          padding: '8px 14px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          backdropFilter: BACKDROP_BLUR,
          cursor: 'pointer',
          transition: 'background 0.2s',
          color: '#fff',
          fontFamily: 'inherit',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = PILL_HOVER_BG; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = PILL_BG; }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600 }}>Daily Brief</span>
      </button>
    );
  }

  // ─── Expanded card ───
  return (
    <div style={{ padding: '0 16px' }}>
      <div style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER_ACCENT}`,
        borderRadius: '20px',
        padding: '20px',
        backdropFilter: BACKDROP_BLUR,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>🗞️</span>
            <span style={{ fontSize: '15px', fontWeight: 700 }}>Daily Brief</span>
            <span style={{
              fontSize: '11px',
              background: TAG_BG['MARKET'],
              color: TAG_COLORS['MARKET'],
              padding: '2px 8px',
              borderRadius: '999px',
            }}>
              Today
            </span>
            <span style={{
              fontSize: '10px',
              color: 'rgba(34,211,238,0.7)',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              letterSpacing: '0.04em',
            }}>
              <span style={{ fontSize: '10px' }}>✨</span> AI
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: '13px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            ▴ Show less
          </button>
        </div>

        {/* Body — tagged lines */}
        {parsed.map((line, i) => (
          <div
            key={i}
            style={{
              marginBottom: i < parsed.length - 1 ? '16px' : 0,
              lineHeight: '1.6',
              fontSize: '15px',
            }}
          >
            {line.label ? (
              <>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '11px',
                    fontWeight: 800,
                    letterSpacing: '0.03em',
                    padding: '2px 0',
                    marginRight: '6px',
                    color: TAG_COLORS[line.label] || 'rgba(255,255,255,0.75)',
                  }}
                >
                  {line.label}
                </span>
                <span style={{ color: 'rgba(255,255,255,0.75)' }}>{line.text}</span>
              </>
            ) : (
              <span style={{ color: 'rgba(255,255,255,0.75)' }}>{line.text}</span>
            )}
          </div>
        ))}

        {/* Footer */}
        <div style={{
          fontSize: '11px',
          color: TEXT_MUTED,
          marginTop: '16px',
          paddingTop: '14px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
        }}>
          {data?.cached
            ? 'Cached today · Refreshes tomorrow'
            : 'Generated just now · Refreshes tomorrow'}
        </div>
      </div>
    </div>
  );
}
