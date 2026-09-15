'use client';

// ─── LineChart — thin wrapper over the shared PriceChart ─────────
// The chat chart pins a fixed range and hides the range pills, so the line is
// rendered by the SAME component the Portfolio screen uses.

import PriceChart, { type ChartPoint, type ChartRange } from '@/components/shared/PriceChart';

export default function LineChart({
  points,
  range,
}: {
  points: ChartPoint[];
  range: ChartRange;
}) {
  if (!points || points.length === 0) return null;
  return (
    <PriceChart
      points={points}
      range={range}
      onRangeChange={() => {}}
      hideRangeSelector
      height={140}
      gradientId="chatPriceGradient"
    />
  );
}
