'use client';

import { apiGet } from '@/lib/api-client';
import { useState, useEffect } from 'react';

// ── Design tokens ──
const PILL_BG = 'rgba(255,255,255,0.05)';
const PILL_BORDER = 'rgba(255,255,255,0.08)';
const PILL_HOVER_BG = 'rgba(255,255,255,0.08)';
const ACTIVE_PILL_BG = '#ffffff';
const ACTIVE_PILL_COLOR = '#0f172a'; // dark navy
const CARD_BG = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(34,211,238,0.15)';
const BACKDROP_BLUR = 'blur(20px)';

const TAG_COLORS: Record<string, string> = {
  MARKET: '#22d3ee',
  PORTFOLIO: '#10b981',
  WATCH: '#f59e0b',
  EARNINGS: '#a78bfa',
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

function formatTime(iso: string | null | undefined): string {
  if (!iso) return 'just now';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

interface DailyBriefCardProps {
  mode?: 'pill' | 'content';
  active?: boolean;
  onClick?: () => void;
}

export default function DailyBriefCard({ mode = 'pill', active = false, onClick }: DailyBriefCardProps) {
  const [data, setData] = useState<BriefData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    apiGet(`/api/ai/daily-brief?tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ─── Loading skeleton ───
  if (loading) {
    if (mode === 'content') {
      return (
        <div style={{
          marginTop: '10px',
          background: CARD_BG,
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: '18px',
          padding: '18px',
          backdropFilter: BACKDROP_BLUR,
        }}>
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Daily Brief</div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', lineHeight: '1.6' }}>
            Loading…
          </div>
        </div>
      );
    }
    return (
      <button style={{
        flex: 1,
        background: PILL_BG,
        border: `1px solid ${PILL_BORDER}`,
        borderRadius: '999px',
        padding: '14px 14px',
        color: 'rgba(255,255,255,0.4)',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: 700,
        cursor: 'default',
      }}>
        Daily Brief
      </button>
    );
  }

  const brief = data?.content;
  if (!brief) return null;

  const parsed = parseBrief(brief);

  // ─── Pill mode ───
  if (mode === 'pill') {
    return (
      <button
        onClick={onClick}
        style={{
          flex: 1,
          background: active ? ACTIVE_PILL_BG : PILL_BG,
          border: active ? '1px solid rgba(255,255,255,0.2)' : `1px solid ${PILL_BORDER}`,
          borderRadius: '999px',
          padding: '14px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: BACKDROP_BLUR,
          cursor: 'pointer',
          transition: 'all 0.2s',
          color: active ? ACTIVE_PILL_COLOR : '#fff',
          fontFamily: 'inherit',
          fontSize: '14px',
          fontWeight: 700,
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = PILL_HOVER_BG;
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = PILL_BG;
        }}
      >
        Daily Brief
      </button>
    );
  }

  // ─── Content mode — expanded card, no close button, click card to collapse ───
  return (
    <div
      onClick={onClick}
      style={{
        marginTop: '10px',
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: '18px',
        padding: '18px',
        backdropFilter: BACKDROP_BLUR,
        cursor: 'pointer',
      }}
    >
      {/* Header: title left, meta right — clean single line */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '14px',
      }}>
        <span style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>
          Daily Brief<span style={{ fontWeight: 400, color: 'rgba(255,255,255,0.35)', marginLeft: '6px' }}>· Today</span>
        </span>
        <span style={{
          fontSize: '11px',
          color: 'rgba(255,255,255,0.45)',
          display: 'flex',
          alignItems: 'center',
          gap: '3px',
          flexShrink: 0,
          marginLeft: '12px',
        }}>
          ✨ AI · Updated {formatTime(data?.generatedAt)}
        </span>
      </div>

      {/* Body — tagged lines */}
      {parsed.map((line, i) => (
        <div
          key={i}
          style={{
            marginBottom: i < parsed.length - 1 ? '12px' : 0,
            lineHeight: '1.55',
            fontSize: '14px',
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
              <span style={{ color: 'rgba(255,255,255,0.8)' }}>{line.text}</span>
            </>
          ) : (
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>{line.text}</span>
          )}
        </div>
      ))}

      {/* Footer */}
      <div style={{
        fontSize: '11px',
        color: 'rgba(255,255,255,0.25)',
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {data?.cached
          ? 'Cached today · Refreshes tomorrow'
          : 'Generated just now · Refreshes tomorrow'}
      </div>
    </div>
  );
}
