'use client';
import { useState, useEffect, useMemo } from 'react';
import { usePortfolioStore, useChatStore } from '@/store';
import { TrendingUp, Shield, Activity, BarChart3, Globe } from 'lucide-react';
import { calculateConfidence, type FactorResult } from '@/lib/confidence';
import type { ConfidenceBreakdown } from '@/types';

interface ConfidenceBarProps {
  label: string;
  score: number;
  explanation: string;
  icon: typeof TrendingUp;
}

function ConfidenceBar({ label, score, explanation, icon: Icon }: ConfidenceBarProps) {
  const color = score >= 80 ? '#4ade80' : score >= 65 ? '#fbbf24' : '#f87171';
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
      <Icon size={14} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, flex: 1 }}>
            {label}
          </span>
          <span style={{ width: 32, textAlign: 'right', fontSize: 11, fontWeight: 700, color }}>
            {score}%
          </span>
        </div>
        <div style={{ height: 5, background: '#334155', borderRadius: 3, overflow: 'hidden', marginBottom: 3 }}>
          <div
            style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }}
          />
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
          {explanation}
        </div>
      </div>
    </div>
  );
}

export function ConfidenceRing() {
  const { account } = usePortfolioStore();
  const { setConfidence } = useChatStore();
  const [expanded, setExpanded] = useState(false);

  const result = useMemo(() => {
    if (!account?.positions?.length) {
      return null;
    }
    return calculateConfidence(account.positions);
  }, [account?.positions]);

  // Sync confidence to store for other components
  useEffect(() => {
    if (result) {
      const breakdown: ConfidenceBreakdown = {
        overall: result.overall,
        components: {
          diversification: result.factors.diversification.score,
          technicalHealth: result.factors.technicalHealth.score,
          volatilityExposure: result.factors.volatilityExposure.score,
          macroAlignment: result.factors.macroAlignment.score,
          positionQuality: result.factors.positionQuality.score,
        },
        explanation: result.explanation,
        warnings: result.warnings,
      };
      setConfidence(breakdown);
    }
  }, [result, setConfidence]);

  if (!result) {
    return (
      <div className="confidence-hero" style={{ padding: '14px 16px', borderBottom: '1px solid #334155' }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Connect your broker to see portfolio confidence scores.
        </div>
      </div>
    );
  }

  const { overall, factors, explanation, warnings } = result;

  const circumference = 2 * Math.PI * 34;
  const offset = circumference - (overall / 100) * circumference;

  const ringColor = overall >= 80 ? '#4ade80' : overall >= 60 ? '#fbbf24' : '#f87171';
  const ringGradientId = `conf-ring-grad-${overall}`;

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <div className="confidence-hero">
        <div className="confidence-ring-wrapper">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#1e293b" strokeWidth="6" />
            <circle
              cx="40" cy="40" r="34"
              fill="none"
              stroke={`url(#${ringGradientId})`}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 40 40)"
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
            <defs>
              <linearGradient id={ringGradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={overall >= 80 ? '#4ade80' : overall >= 60 ? '#fbbf24' : '#f87171'} />
                <stop offset="100%" stopColor={ringColor} />
              </linearGradient>
            </defs>
          </svg>
          <span className="confidence-value" style={{ color: ringColor }}>
            {overall}%
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            Portfolio Confidence
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600, marginBottom: 2 }}>
            {overall >= 80 ? '🟢 Strong' : overall >= 60 ? '🟡 Moderate' : '🔴 Review needed'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            {overall >= 80
              ? 'Well-diversified with strong risk-adjusted metrics'
              : overall >= 60
              ? 'Decent positioning — small tweaks could help'
              : 'Portfolio needs attention — check the breakdown below'}
          </div>
        </div>
      </div>

      {/* Low-confidence CTA — visible without expanding */}
      {overall < 60 && (
        <div style={{ margin: '12px 16px 0' }}>
          <button
            onClick={() => setExpanded(true)}
            style={{
              width: '100%', padding: '10px 14px',
              background: 'linear-gradient(135deg, #f87171, #ef4444)',
              border: 'none', borderRadius: 10,
              color: '#fff', fontSize: 13, fontWeight: 700,
              cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'opacity 0.15s',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
          >
            <Shield size={14} />
            View Risk Breakdown &amp; Fix Portfolio
          </button>
          <p style={{
            fontSize: 10, color: 'var(--text-muted)',
            textAlign: 'center', marginTop: 6, lineHeight: 1.4,
          }}>
            See which positions are dragging your score down
          </p>
        </div>
      )}

      {/* Expandable breakdown */}
      <div style={{ margin: '0 16px 12px' }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            cursor: 'pointer', fontSize: 11, color: 'var(--accent-cyan)',
            fontWeight: 600, padding: '8px 12px', background: '#1e293b',
            borderRadius: 8, border: '1px solid #334155',
            width: '100%', textAlign: 'left', display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>{expanded ? 'Hide' : 'See'} what&apos;s driving this score</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </button>

        {expanded && (
          <div style={{
            marginTop: 8, padding: 12, background: '#1e293b',
            borderRadius: 10, border: '1px solid #334155',
          }}>
            <ConfidenceBar
              label="Diversification"
              score={factors.diversification.score}
              explanation={factors.diversification.explanation.replace(/^Diversification \(\d+\/100\): /, '')}
              icon={BarChart3}
            />
            <ConfidenceBar
              label="Technical Health"
              score={factors.technicalHealth.score}
              explanation={factors.technicalHealth.explanation.replace(/^Technical Health \(\d+\/100\): /, '')}
              icon={Activity}
            />
            <ConfidenceBar
              label="Volatility Exposure"
              score={factors.volatilityExposure.score}
              explanation={factors.volatilityExposure.explanation.replace(/^Volatility Exposure \(\d+\/100\): /, '')}
              icon={Shield}
            />
            <ConfidenceBar
              label="Macro Alignment"
              score={factors.macroAlignment.score}
              explanation={factors.macroAlignment.explanation.replace(/^Macro Alignment \(\d+\/100\): /, '')}
              icon={Globe}
            />
            <ConfidenceBar
              label="Position Quality"
              score={factors.positionQuality.score}
              explanation={factors.positionQuality.explanation.replace(/^Position Quality \(\d+\/100\): /, '')}
              icon={TrendingUp}
            />

            {/* Summary */}
            <div style={{ marginTop: 10, padding: 10, background: '#0f172a', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--accent-cyan)' }}>How this works:</strong>{' '}
              Each factor is scored 0-100 and weighted:
              Diversification 25% · Technical Health 20% · Volatility 20% · Macro 15% · Position Quality 20%
            </div>

            {/* Warnings */}
            {warnings.length > 0 && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {warnings.map((w, i) => (
                  <div key={i} style={{
                    fontSize: 10, color: '#fbbf24', padding: '6px 8px',
                    background: 'rgba(251,191,36,0.1)', borderRadius: 4,
                    borderLeft: '2px solid #fbbf24', lineHeight: 1.4,
                  }}>
                    ⚠️ {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .confidence-hero {
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(6,182,212,0.1) 0%, rgba(13,148,136,0.05) 100%);
          border-bottom: 1px solid #334155;
          display: flex;
          gap: 14px;
          align-items: center;
        }
        .confidence-ring-wrapper {
          width: 80px; height: 80px;
          position: relative;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .confidence-value {
          position: absolute;
          font-size: 1.25rem;
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}
