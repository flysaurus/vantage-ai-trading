'use client';

import { useState, useEffect, useRef } from 'react';
import type { Position } from '@/types';

// ── Types ─────────────────────────────────────────────────────

interface RiskTrigger {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  metrics: Record<string, unknown>;
}

interface NarrativeResponse {
  narrative: string | null;
  suggestion?: string | null;
  triggers: RiskTrigger[];
  cached: boolean;
  consumedDeepAnalysis?: boolean;
  sectorCount?: number;
  limitReached?: boolean;
  limitReason?: string;
  aiError?: boolean;
}

// ── Props ─────────────────────────────────────────────────────

export interface RiskNarrativeCardProps {
  positions: Position[];
  investorStyle?: string;
}

// ── Helpers ──────────────────────────────────────────────────

type SeverityLevel = 'safe' | 'warning' | 'critical';

function overallSeverity(triggers: RiskTrigger[]): SeverityLevel {
  if (triggers.length === 0) return 'safe';
  if (triggers.some((t) => t.severity === 'critical')) return 'critical';
  return 'warning';
}

const SEVERITY_COLORS: Record<SeverityLevel, { bg: string; border: string; text: string; dot: string }> = {
  safe: {
    bg: 'rgba(16,185,129,0.06)',
    border: 'rgba(16,185,129,0.25)',
    text: '#34d399',
    dot: '#10b981',
  },
  warning: {
    bg: 'rgba(245,158,11,0.06)',
    border: 'rgba(245,158,11,0.25)',
    text: '#fbbf24',
    dot: '#f59e0b',
  },
  critical: {
    bg: 'rgba(239,68,68,0.06)',
    border: 'rgba(239,68,68,0.25)',
    text: '#f87171',
    dot: '#ef4444',
  },
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  safe: 'Well Diversified',
  warning: 'Check Allocation',
  critical: 'High Risk',
};

// ── Component ─────────────────────────────────────────────────

export default function RiskNarrativeCard({
  positions,
  investorStyle,
}: RiskNarrativeCardProps) {
  const [data, setData] = useState<NarrativeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generatingRef = useRef(false);

  // Deep-analysis remaining for the consent-gate pre-spend notice.
  const [deepRemaining, setDeepRemaining] = useState<number | null>(null);
  const [deepIsPoolExhausted, setDeepIsPoolExhausted] = useState(false);
  const [deepIsDailyExhausted, setDeepIsDailyExhausted] = useState(false);

  // Fetch remaining on mount so the button shows the spend BEFORE firing.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = new Date();
        const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const res = await fetch(`/api/usage/remaining?localDate=${encodeURIComponent(localDate)}`);
        if (res.ok && active) {
          const r = await res.json();
          const poolExhausted = r.deepPoolRemaining !== null && r.deepPoolRemaining <= 0;
          setDeepRemaining(r.effectiveDeepRemaining ?? r.deepRemaining ?? null);
          setDeepIsPoolExhausted(poolExhausted);
          setDeepIsDailyExhausted(!poolExhausted && (r.deepRemaining ?? 0) <= 0);
        }
      } catch { /* fail silently — server enforces the real limit */ }
    })();
    return () => { active = false; };
  }, [positions]);

  // ── Consent-gated generation: ONLY fires on explicit tap ──
  const generate = async () => {
    if (!positions || positions.length === 0) return;
    if (generatingRef.current) return;
    generatingRef.current = true;
    setLoading(true);
    try {
      const payload = {
        positions: positions.map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          currentPrice: p.currentPrice,
          sector: p.sector,
          avgCost: p.avgCost,
        })),
        investorStyle: investorStyle || undefined,
      };

      const res = await fetch('/api/risk-narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        setData(null);
        return;
      }

      const result: NarrativeResponse = await res.json();
      setData(result);
    } catch (err: any) {
      setData(null);
    } finally {
      generatingRef.current = false;
      setLoading(false);
    }
  };

  // ── No positions → nothing to show ──
  if (!positions || positions.length === 0) {
    return null;
  }

  // ── Idle — explicit consent gate (NO auto-fire) ──
  if (!data && !loading) {
    const exhausted = deepRemaining !== null && deepRemaining <= 0;
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: '#22d3ee',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#22d3ee',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Risk Analysis
          </span>
        </div>

        <p
          style={{
            margin: '8px 0 12px 0',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'rgba(255,255,255,0.66)',
          }}
        >
          Check your portfolio for concentration, sector, and style-drift risks.
        </p>

        <button
          onClick={generate}
          disabled={exhausted}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: exhausted ? 'rgba(255,255,255,0.06)' : 'rgba(34,211,238,0.14)',
            border: exhausted ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(34,211,238,0.4)',
            borderRadius: 8,
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 700,
            color: exhausted ? 'rgba(255,255,255,0.4)' : '#67e8f9',
            cursor: exhausted ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {exhausted ? 'No deep analyses available' : 'Generate risk analysis (1 deep)'}
        </button>

        {/* Pre-spend notice — the cost is visible BEFORE firing */}
        <div
          style={{
            marginTop: 8,
            fontSize: 10,
            fontStyle: 'italic',
            color: exhausted ? 'rgba(251,191,36,0.85)' : 'rgba(255,255,255,0.4)',
          }}
        >
          {exhausted
            ? deepIsPoolExhausted
              ? 'Trial pool exhausted — no daily reset. Upgrade for more deep analyses.'
              : deepIsDailyExhausted
                ? 'Daily limit reached — resets tomorrow.'
                : 'No deep analyses available.'
            : deepRemaining === 1
              ? '⚠️ Uses 1 deep analysis — this is your last one.'
              : deepRemaining !== null
                ? `Uses 1 deep analysis — ${deepRemaining} remaining today.`
                : 'Uses 1 deep analysis.'}
        </div>
      </div>
    );
  }

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 12,
          opacity: 0.6,
        }}
      >
        <div
          style={{
            height: 14,
            width: '70%',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 4,
            marginBottom: 8,
          }}
        />
        <div
          style={{
            height: 10,
            width: '50%',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 4,
          }}
        />
      </div>
    );
  }

  // ── Error / no data ──
  if (!data) {
    return null;
  }

  const severity = overallSeverity(data.triggers);
  const colors = SEVERITY_COLORS[severity];
  const sectorCount = data.sectorCount || 0;

  // Build display text
  let displayText: string;
  if (data.narrative) {
    displayText = data.narrative;
  } else if (data.triggers.length === 0) {
    displayText = `Well diversified across ${sectorCount} sector${sectorCount !== 1 ? 's' : ''}`;
  } else if (data.limitReached) {
    displayText = data.triggers[0]?.message || 'Portfolio has some concentration risks.';
  } else if (data.aiError) {
    displayText = data.triggers[0]?.message || 'Portfolio has some concentration risks.';
  } else {
    displayText = data.triggers[0]?.message || 'Check your portfolio allocation.';
  }

  const hasTriggers = data.triggers.length > 0;

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        marginBottom: 12,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        cursor: hasTriggers ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
      onClick={() => hasTriggers && setExpanded(!expanded)}
      role={hasTriggers ? 'button' : undefined}
      tabIndex={hasTriggers ? 0 : undefined}
      onKeyDown={(e) => {
        if (hasTriggers && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          setExpanded(!expanded);
        }
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Severity dot */}
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: colors.dot,
              flexShrink: 0,
            }}
          />
          {/* Status label */}
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.text,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {SEVERITY_LABELS[severity]}
          </span>
          {data.cached && (
            <span
              style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.3)',
                fontStyle: 'italic',
              }}
            >
              cached
            </span>
          )}
        </div>

        {hasTriggers && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            style={{
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
            }}
          >
            <path
              d="M3.5 5.25L7 8.75L10.5 5.25"
              stroke={colors.text}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Narrative text */}
      <p
        style={{
          margin: '8px 0 0 0',
          fontSize: 13,
          lineHeight: 1.5,
          color: 'rgba(255,255,255,0.78)',
          letterSpacing: '0.01em',
        }}
      >
        {displayText}
      </p>

      {/* Consumption notice — the spend is surfaced, never silent */}
      {data.consumedDeepAnalysis && (
        <div
          style={{
            marginTop: 6,
            fontSize: 10,
            color: 'rgba(255,255,255,0.4)',
            fontStyle: 'italic',
          }}
        >
          Used 1 deep analysis
        </div>
      )}

      {/* Expanded trigger details */}
      {expanded && hasTriggers && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {data.triggers.map((t, i) => (
            <div
              key={i}
              style={{
                fontSize: 12,
                color:
                  t.severity === 'critical'
                    ? '#f87171'
                    : t.severity === 'warning'
                      ? '#fbbf24'
                      : 'rgba(255,255,255,0.6)',
                lineHeight: 1.5,
                padding: '4px 0',
              }}
            >
              <span style={{ marginRight: 6 }}>
                {t.severity === 'critical' ? '🔴' : t.severity === 'warning' ? '🟡' : 'ℹ️'}
              </span>
              {t.message}
            </div>
          ))}

          {/* Mitigation suggestion — visually distinct from diagnostic bullets */}
          {data.suggestion && (
            <div
              style={{
                marginTop: 10,
                paddingTop: 10,
                borderTop: '1px solid rgba(34,211,238,0.12)',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1 }}>💡</span>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#22d3ee',
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    marginBottom: 3,
                  }}
                >
                  Suggestion
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'rgba(255,255,255,0.72)',
                  }}
                >
                  {data.suggestion}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
