// ─── ScoreHistoryChart ───────────────────────────────────────
// Recharts LineChart for investor score history.
// Shows weekly score snapshots as a line with gradient fill.
//
// Props: history (ScoreSnapshot[]), loading (boolean)
// All colors via CSS design tokens.

'use client';

import React from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  CartesianGrid,
} from 'recharts';
import type { ScoreSnapshot } from '@/lib/investor-score/snapshot';

// ─── Types ────────────────────────────────────────────────────

interface ScoreHistoryChartProps {
  history: ScoreSnapshot[];
  loading?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────

function formatChartData(history: ScoreSnapshot[]) {
  return history.map((snap, i) => ({
    label: `W${i + 1}`,
    score: snap.score,
    date: snap.date,
  }));
}

// ─── Component ───────────────────────────────────────────────

export function ScoreHistoryChart({ history, loading }: ScoreHistoryChartProps) {
  // ── Loading skeleton ──────────────────────────────────
  if (loading) {
    return (
      <div style={{ width: '100%', paddingBottom: 'var(--space-4)' }}>
        {/* Section label skeleton */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-4)',
        }}>
          <div style={{
            width: '90px',
            height: '14px',
            borderRadius: '4px',
            background: 'var(--border-card)',
          }} />
          <div style={{
            width: '50px',
            height: '20px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--border-card)',
          }} />
        </div>
        {/* Chart skeleton */}
        <div style={{
          width: '100%',
          height: '120px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" opacity={0.3}>
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
      </div>
    );
  }

  // ── Empty / insufficient data ─────────────────────────
  if (!history || history.length < 2) {
    return (
      <div style={{ width: '100%', paddingBottom: 'var(--space-4)' }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 'var(--space-4)',
        }}>
          <span style={{
            fontSize: '14px',
            fontWeight: 600,
            color: 'var(--text-primary)',
          }}>
            Score History
          </span>
          {history.length > 0 && (
            <span style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--accent-primary-10)',
              color: 'var(--accent-primary)',
            }}>
              1 week
            </span>
          )}
        </div>
        <div style={{
          width: '100%',
          height: '120px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 var(--space-4)',
        }}>
          <span style={{
            fontSize: '12px',
            color: 'var(--text-primary)',
            textAlign: 'center',
            lineHeight: 1.5,
          }}>
            Check back next week for your trend
          </span>
        </div>
      </div>
    );
  }

  // ── Chart data ────────────────────────────────────────
  const chartData = formatChartData(history);
  const isSinglePoint = chartData.length === 1;

  return (
    <div style={{ width: '100%', paddingBottom: 'var(--space-4)' }}>
      {/* Section header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 'var(--space-3)',
      }}>
        <span style={{
          fontSize: '14px',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Score History
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 600,
          padding: '2px 10px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--accent-primary-10)',
          color: 'var(--accent-primary)',
        }}>
          {chartData.length} weeks
        </span>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(255,255,255,0.04)"
            vertical={false}
          />

          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fill: 'var(--text-muted)',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            }}
            dy={6}
          />

          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fill: 'var(--text-muted)',
              fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
            }}
            domain={['dataMin - 20', 'dataMax + 20']}
            width={40}
          />

          <Tooltip
            contentStyle={{
              background: '#1a2235',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#ffffff',
              padding: '8px 12px',
            }}
            labelStyle={{ color: '#94a3b8', fontWeight: 600 }}
            formatter={(value: any) => [
              <span style={{ color: '#22d3ee', fontWeight: 600 }}>{value}</span>,
              'Score',
            ]}
          />

          {/* Gradient area fill */}
          <Area
            type="monotone"
            dataKey="score"
            fill="url(#scoreGradient)"
            stroke="none"
          />

          {/* Line */}
          <Line
            type="monotone"
            dataKey="score"
            stroke="#22d3ee"
            strokeWidth={2}
            dot={(props: any) => {
              const { cx, cy, index } = props;
              // Only show dot on latest point
              if (isSinglePoint || index === chartData.length - 1) {
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="#22d3ee"
                    stroke="#0a0f1e"
                    strokeWidth={2}
                  />
                );
              }
              return null;
            }}
            activeDot={{ r: 5, fill: '#22d3ee', stroke: '#0a0f1e', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
