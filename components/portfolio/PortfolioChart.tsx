'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { apiPost } from '@/lib/api-client';

type Range = '1D' | '1W' | '1M' | 'YTD' | 'ALL';

interface PositionInput {
  symbol: string;
  shares: number;
  buyDate?: string;
  avgCost?: number;
  totalCost?: number;
}

interface ChartPoint {
  timestamp: number;
  value: number;
}

interface Props {
  positions: PositionInput[];
  cashBalance: number;
}

// ─── Helpers ─────────────────────────────────────────

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', DOLLAR_FMT);
}

const RANGES: Range[] = ['1D', '1W', '1M', 'YTD', 'ALL'];

// ─── Component ────────────────────────────────────────

export default function PortfolioChart({ positions, cashBalance }: Props) {
  const [range, setRange] = useState<Range>('1M');
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [rangeReturn, setRangeReturn] = useState(0);
  const [rangeReturnPct, setRangeReturnPct] = useState(0);

  const fetchChartData = useCallback(
    async (r: Range) => {
      if (!positions || positions.length === 0) return;

      setLoading(true);
      setError(false);
      try {
        const res = await apiPost('/api/portfolio/chart', JSON.stringify({
          positions: positions.map((p) => ({
            symbol: p.symbol,
            shares: p.shares,
            buyDate: p.buyDate,
            avgCost: p.avgCost,
            totalCost: p.totalCost ?? p.shares * (p.avgCost ?? 0),
          })),
          cashBalance,
          range: r,
        }));

        const json = await res.json();
        if (!json.points || json.points.length === 0) {
          if (json.error) setError(true);
          else setData([]);
          return;
        }

        setData(json.points);

        if (json.points.length >= 2) {
          const first = json.points[0].value;
          const last = json.points[json.points.length - 1].value;
          setRangeReturn(last - first);
          setRangeReturnPct(((last - first) / (first || 1)) * 100);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [positions, cashBalance],
  );

  useEffect(() => {
    fetchChartData(range);
  }, [range, fetchChartData]);

  // ── Derived display ──
  const isPositive = rangeReturn >= 0;
  const lineColor = isPositive ? '#10b981' : '#ef4444';
  const returnSign = isPositive ? '+' : '';

  // ── X-axis label formatter ──
  const formatXAxis = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    switch (range) {
      case '1D':
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });
      case '1W':
        return date.toLocaleDateString('en-US', {
          weekday: 'short',
        });
      case '1M':
        return date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
      case 'YTD':
      case 'ALL':
        return date.toLocaleDateString('en-US', {
          month: 'short',
          year: '2-digit',
        });
    }
  };

  // ── Custom tooltip ──
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value as number;
    const ts = payload[0].payload.timestamp as number;
    return (
      <div
        style={{
          background: '#1a2235',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '8px 12px',
        }}
      >
        <div style={{ color: '#ffffff', fontWeight: 600 }}>
          ${formatCurrency(val)}
        </div>
        <div style={{ color: '#6b7280', fontSize: '11px' }}>
          {formatXAxis(ts)}
        </div>
      </div>
    );
  };

  // ── Label override so Recharts doesn't warn ──
  CustomTooltip.displayName = 'CustomTooltip';

  // ── Don't render if no positions ──
  if (!positions || positions.length === 0) return null;

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Range return indicator */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: '4px',
          paddingRight: '4px',
        }}
      >
        <span
          style={{
            color: isPositive ? '#10b981' : '#ef4444',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {returnSign}${formatCurrency(Math.abs(rangeReturn))} (
          {returnSign}
          {rangeReturnPct.toFixed(1)}%) this {range}
        </span>
      </div>

      {/* Chart area */}
      {loading ? (
        <div
          style={{
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '2px',
              background:
                'linear-gradient(90deg, transparent, #22d3ee, transparent)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        </div>
      ) : error ? (
        <div
          style={{
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4b5563',
            fontSize: '12px',
          }}
        >
          Chart unavailable
        </div>
      ) : data.length > 0 ? (
        <ResponsiveContainer width="100%" height={120}>
          <AreaChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          >
            <defs>
              <linearGradient id="portfolioGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatXAxis}
              tick={{ fill: '#4b5563', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['dataMin - 500', 'dataMax + 500']} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              fill="url(#portfolioGradient)"
              dot={false}
              activeDot={{
                r: 4,
                fill: lineColor,
                stroke: '#0a0f1e',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div
          style={{
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#4b5563',
            fontSize: '12px',
          }}
        >
          No data
        </div>
      )}

      {/* Range selector pills */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '4px',
          marginTop: '8px',
        }}
      >
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => { setRange(r); setData([]); }}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: range === r ? '600' : '400',
              background:
                range === r ? 'rgba(34,211,238,0.15)' : 'transparent',
              border:
                range === r
                  ? '1px solid rgba(34,211,238,0.5)'
                  : '1px solid transparent',
              color: range === r ? '#22d3ee' : '#6b7280',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
