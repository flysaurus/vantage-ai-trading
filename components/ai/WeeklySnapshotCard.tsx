'use client';

import { apiDelete, apiGet } from '@/lib/api-client';
import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// ── Design tokens ──
const PILL_BG = 'rgba(255,255,255,0.05)';
const PILL_BORDER = 'rgba(255,255,255,0.08)';
const PILL_HOVER_BG = 'rgba(255,255,255,0.08)';
const ACTIVE_PILL_BG = '#ffffff';
const ACTIVE_PILL_COLOR = '#0f172a';
const CARD_BG = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(34,211,238,0.15)';
const SUB_PILL_BG = 'rgba(255,255,255,0.04)';
const SUB_PILL_BORDER = 'rgba(255,255,255,0.06)';
const TEXT_BODY = 'rgba(255,255,255,0.75)';
const BACKDROP_BLUR = 'blur(20px)';

const ACCENT = '#22d3ee';
const GAIN = '#10b981';
const WARNING = '#f59e0b';
const LOSS = '#ef4444';

const BADGE_LOW_BG = 'rgba(16,185,129,0.15)';
const BADGE_MED_BG = 'rgba(245,158,11,0.15)';
const BADGE_HIGH_BG = 'rgba(239,68,68,0.15)';

interface SnapshotData {
  content?: string | null;
  healthScore?: number | null;
  riskLevel?: string | null;
  opportunitiesCount?: number;
  weekStart?: string;
  generatedAt?: string | null;
  cached?: boolean;
}

interface ParsedSections {
  health: string;
  risk: string;
  opportunities: string;
  summary: string;
}

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: '14px', lineHeight: '1.7', color: TEXT_BODY, marginBottom: '8px' }}>{children}</p>
  ),
  strong: ({ children }: { children: React.ReactNode }) => (
    <strong style={{ color: '#fff' }}>{children}</strong>
  ),
  h2: ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#fff', marginTop: '12px', marginBottom: '6px' }}>{children}</h2>
  ),
  h3: ({ children }: { children: React.ReactNode }) => (
    <h3 style={{ fontSize: '12px', fontWeight: 600, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '10px', marginBottom: '4px' }}>{children}</h3>
  ),
  ul: ({ children }: { children: React.ReactNode }) => (
    <ul style={{ paddingLeft: '16px', margin: '0' }}>{children}</ul>
  ),
  ol: ({ children }: { children: React.ReactNode }) => (
    <ol style={{ paddingLeft: '16px', margin: '0' }}>{children}</ol>
  ),
  li: ({ children }: { children: React.ReactNode }) => (
    <li style={{ fontSize: '14px', lineHeight: '1.7', color: TEXT_BODY, marginBottom: '4px' }}>{children}</li>
  ),
  hr: () => <hr style={{ borderColor: 'rgba(255,255,255,0.06)', margin: '10px 0' }} />,
  blockquote: ({ children }: { children: React.ReactNode }) => (
    <blockquote style={{
      borderLeft: '2px solid rgba(34,211,238,0.5)',
      paddingLeft: '12px',
      margin: '6px 0',
      fontSize: '12px',
      fontStyle: 'italic',
      color: TEXT_BODY,
    }}>
      {children}
    </blockquote>
  ),
};

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

function extractRiskFromSection(section: string): string | null {
  if (!section) return null;
  const match = section.match(/\b(LOW|MEDIUM|HIGH)\b/i);
  return match ? match[1].toUpperCase() : null;
}

function parseSections(content: string): ParsedSections {
  const healthMatch = content.match(/(?:^#*\s*)?(?:OVERALL HEALTH|PORTFOLIO HEALTH).*\n([\s\S]*?)(?=^#*\s*(?:RISKS?|OVERALL RISK|RISK LEVEL)|\Z)/im);
  const riskMatch = content.match(/(?:^#*\s*)?(?:RISKS?|OVERALL RISK|RISK LEVEL).*\n([\s\S]*?)(?=^#*\s*(?:OPPORTUNITIES?|SUMMARY)|\Z)/im);
  const oppMatch = content.match(/(?:^#*\s*)?OPPORTUNITIES?.*\n([\s\S]*?)(?=^#*\s*(?:SUMMARY|RISK|RISKS)(?:\s|$)|\Z)/im);
  const summaryMatch = content.match(/(?:^#*\s*)?SUMMARY.*\n?([\s\S]*?)$/im);
  return {
    health: (healthMatch?.[1] || '').trim(),
    risk: (riskMatch?.[1] || '').trim(),
    opportunities: (oppMatch?.[1] || '').trim(),
    summary: (summaryMatch?.[1] || '').trim(),
  };
}

const SUB_CARD_TITLES: Record<string, string> = {
  health: 'Portfolio Health',
  risk: 'Risk Assessment',
  opportunities: 'Opportunities',
};

const SUB_CARD_ORDER = ['health', 'risk', 'opportunities'] as const;

interface WeeklySnapshotCardProps {
  mode?: 'pill' | 'content';
  active?: boolean;
  onClick?: () => void;
}

export default function WeeklySnapshotCard({ mode = 'pill', active = false, onClick }: WeeklySnapshotCardProps) {
  const [data, setData] = useState<SnapshotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCard, setExpandedCard] = useState<'health' | 'risk' | 'opportunities' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
      const r = await apiGet(`/api/ai/weekly-snapshot?tz=${encodeURIComponent(tz)}`);
      const d = await r.json();
      setData(d);
    } catch {
      // keep existing data
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    try {
      await apiDelete('/api/ai/weekly-snapshot');
    } catch { /* continue */ }
    await load();
  };

  const toggleCard = (e: React.MouseEvent, card: 'health' | 'risk' | 'opportunities') => {
    e.stopPropagation();
    setExpandedCard((prev) => (prev === card ? null : card));
  };

  const Chevron = ({ open }: { open: boolean }) => (
    <svg
      className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      style={{ width: '14px', height: '14px', color: 'rgba(255,255,255,0.3)' }}
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
  if (loading && !data) {
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
          <div style={{ fontSize: '14px', fontWeight: 700, marginBottom: '12px' }}>Weekly Snapshot</div>
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
        Weekly Snapshot
      </button>
    );
  }

  if (!data?.content) {
    // Show fallback instead of returning null — so the user sees SOMETHING
    if (mode === 'content') {
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
          <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff', marginBottom: '10px' }}>
            Weekly Snapshot
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)', lineHeight: '1.6' }}>
            {loading
              ? 'Generating your weekly analysis…'
              : 'No snapshot available yet. Check back after market close on Friday — your weekly portfolio review is generated over the weekend.'}
          </div>
        </div>
      );
    }
    return null;
  }

  const { healthScore, riskLevel: apiRiskLevel, opportunitiesCount, generatedAt } = data;
  const sections = parseSections(data.content);
  const riskLevel = apiRiskLevel || extractRiskFromSection(sections.risk);

  const realOppCount = (() => {
    if (opportunitiesCount != null && opportunitiesCount > 0) return opportunitiesCount;
    const bullets = sections.opportunities.match(/^\s*(?:[-•*]\s|\d+\.\s|\*\*\d+\.\*\*\s)/gm);
    return bullets ? bullets.length : 0;
  })();

  const healthSummaryColor = healthScore != null
    ? healthScore >= 7 ? GAIN : healthScore >= 5 ? WARNING : LOSS
    : 'rgba(255,255,255,0.3)';

  const riskSummaryColor = riskLevel === 'LOW' ? GAIN : riskLevel === 'HIGH' ? LOSS : riskLevel === 'MEDIUM' ? WARNING : 'rgba(255,255,255,0.3)';
  const riskBadgeBg = riskLevel === 'LOW' ? BADGE_LOW_BG : riskLevel === 'HIGH' ? BADGE_HIGH_BG : riskLevel === 'MEDIUM' ? BADGE_MED_BG : 'transparent';

  const subCardValue = (card: 'health' | 'risk' | 'opportunities'): { text: string; color: string; isBadge?: boolean; badgeBg?: string } | null => {
    switch (card) {
      case 'health':
        if (healthScore != null) return { text: `${healthScore}/10`, color: healthSummaryColor };
        return { text: 'Calculating…', color: 'rgba(255,255,255,0.3)' };
      case 'risk':
        if (riskLevel) return { text: riskLevel, color: riskSummaryColor, isBadge: true, badgeBg: riskBadgeBg };
        return { text: 'Calculating…', color: 'rgba(255,255,255,0.3)' };
      case 'opportunities':
        if (realOppCount > 0) return { text: `${realOppCount}`, color: GAIN };
        return { text: '0', color: 'rgba(255,255,255,0.3)' };
    }
  };

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
          gap: '8px',
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
        Weekly Snapshot
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
          Weekly Snapshot
        </span>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
          marginLeft: '12px',
        }}>
          <span style={{
            fontSize: '11px',
            color: 'rgba(255,255,255,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
          }}>
            ✨ AI · Updated {formatTime(generatedAt)}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.3)',
              cursor: 'pointer',
              fontSize: '13px',
              lineHeight: 1,
              fontFamily: 'inherit',
              opacity: refreshing ? 0.5 : 1,
            }}
          >
            ↻
          </button>
        </div>
      </div>

      {/* Sub-pills */}
      {SUB_CARD_ORDER.map((key, idx) => {
        const value = subCardValue(key as 'health' | 'risk' | 'opportunities');
        const isExpanded = expandedCard === key;
        const sectionContent = sections[key as keyof ParsedSections];

        return (
          <div key={key} style={{ marginBottom: idx < SUB_CARD_ORDER.length - 1 ? '8px' : 0 }}>
            <button
              onClick={(e) => toggleCard(e, key as 'health' | 'risk' | 'opportunities')}
              style={{
                width: '100%',
                textAlign: 'left',
                background: SUB_PILL_BG,
                border: `1px solid ${SUB_PILL_BORDER}`,
                borderRadius: '16px',
                padding: '14px 16px',
                cursor: 'pointer',
                color: '#fff',
                fontFamily: 'inherit',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{SUB_CARD_TITLES[key]}</span>
                </div>
                {value && (
                  <span style={{
                    fontSize: '13px',
                    fontWeight: 700,
                    marginLeft: 'auto',
                    marginRight: '10px',
                    ...(value.isBadge ? {
                      background: value.badgeBg,
                      color: value.color,
                      padding: '3px 9px',
                      borderRadius: '999px',
                    } : {
                      color: value.color,
                    }),
                  }}>
                    {value.text}
                  </span>
                )}
                <Chevron open={isExpanded} />
              </div>
            </button>

            {isExpanded && sectionContent && (
              <div style={{
                fontSize: '14px',
                lineHeight: '1.7',
                color: TEXT_BODY,
                marginTop: '12px',
                paddingTop: '12px',
                paddingLeft: '26px',
                paddingRight: '10px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
              }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={MARKDOWN_COMPONENTS as any}
                >
                  {sectionContent}
                </ReactMarkdown>
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      <div style={{
        fontSize: '11px',
        color: 'rgba(255,255,255,0.25)',
        marginTop: '12px',
        paddingTop: '10px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {data.cached ? 'Refreshes next week' : 'Fresh analysis'} · Tap any card to expand
      </div>
    </div>
  );
}
