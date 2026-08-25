'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export type ChartRange = '1D' | '1W' | '1M' | 'YTD' | 'ALL';

export interface ChartPoint {
  timestamp: number; // unix seconds
  value: number;
}

interface PriceChartProps {
  points: ChartPoint[];
  range: ChartRange;
  onRangeChange: (r: ChartRange) => void;
  loading?: boolean;
  error?: boolean;
  height?: number;
  gradientId?: string;
  lineColor?: string; // optional override; else derived from return sign
  valuePrefix?: string; // prefix shown in the tooltip (default '$')
}

const RANGES: ChartRange[] = ['1D', '1W', '1M', 'YTD', 'ALL'];

const DOLLAR_FMT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function formatCurrency(n: number): string {
  return n.toLocaleString('en-US', DOLLAR_FMT);
}

function formatXAxis(timestamp: number, range: ChartRange): string {
  const date = new Date(timestamp * 1000);
  switch (range) {
    case '1D':
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    case '1W':
      return date.toLocaleDateString('en-US', { weekday: 'short' });
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
}

/**
 * Presentational area chart with scrubbable tooltip + range pills.
 * Shared by the Portfolio total-value chart and the index detail chart.
 *
 * "Never block render": `loading` renders a lightweight pulse bar in-place
 * (never a full-page spinner), so parent pages keep rendering around it.
 */
export default function PriceChart({
  points,
  range,
  onRangeChange,
  loading = false,
  error = false,
  height = 120,
  gradientId = 'priceGradient',
  lineColor,
  valuePrefix = '$',
}: PriceChartProps) {
  const hasReturn = points.length >= 2;
  const rangeReturn = hasReturn ? points[points.length - 1].value - points[0].value : 0;
  const rangeReturnPct = hasReturn
    ? (points[0].value ? (rangeReturn / points[0].value) * 100 : 0)
    : 0;
  const isPositive = hasReturn ? rangeReturn >= 0 : true;
  const effectiveLineColor =
    lineColor ?? (isPositive ? '#10b981' : '#ef4444');
  const returnSign = isPositive ? '+' : '';

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value as number;
    const ts = payload[0].payload.timestamp as number;
    return (
      <div
        style={{
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(34, 211, 238, 0.25)',
          borderRadius: '10px',
          padding: '8px 14px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ color: '#22d3ee', fontWeight: 600, fontSize: 14 }}>
          {valuePrefix}
          {formatCurrency(val)}
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>
          {formatXAxis(ts, range)}
        </div>
      </div>
    );
  };
  CustomTooltip.displayName = 'CustomTooltip';

  return (
    <div style={{ marginTop: '8px' }}>
      {/* Range return indicator */}
      {hasReturn && (
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
            {returnSign}
            {valuePrefix}
            {formatCurrency(Math.abs(rangeReturn))} ({returnSign}
            {rangeReturnPct.toFixed(1)}%) this {range}
          </span>
        </div>
      )}

      {/* Chart area */}
      {loading ? (
        <div
          style={{
            height,
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
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '12px',
          }}
        >
          Chart unavailable
        </div>
      ) : points.length > 0 ? (
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart
            data={points}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={effectiveLineColor} stopOpacity={0.3} />
                <stop offset="95%" stopColor={effectiveLineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts: number) => formatXAxis(ts, range)}
              tick={{ fill: '#9ca3af', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{
                stroke: 'rgba(34, 211, 238, 0.35)',
                strokeWidth: 1,
                strokeDasharray: '4 3',
              }}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={effectiveLineColor}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{
                r: 4,
                fill: effectiveLineColor,
                stroke: '#0a0f1e',
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div
          style={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
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
            onClick={() => onRangeChange(r)}
            style={{
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: range === r ? '600' : '400',
              background: range === r ? 'rgba(34,211,238,0.15)' : 'transparent',
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
