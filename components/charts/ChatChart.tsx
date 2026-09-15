'use client';

// ─── ChatChart — dispatch a resolved chart to its renderer ───────
// The server decides the TYPE (there is no client-side inference from data
// shape). An unknown type renders nothing.

import type { ResolvedChart } from '@/lib/ai/chart-registry';
import ChatChartFrame from './ChatChartFrame';
import BarChart from './BarChart';
import DonutChart from './DonutChart';
import LineChart from './LineChart';
import StatCallout from './StatCallout';
import TreemapChart from './TreemapChart';
import ScatterChart from './ScatterChart';
import WaterfallChart from './WaterfallChart';

export default function ChatChart({ chart }: { chart: ResolvedChart }) {
  if (!chart || !chart.data) return null;
  const { type, key, title, subtitle, footnote, data } = chart;

  let body: React.ReactNode = null;

  switch (type) {
    case 'bar':
      body = (
        <BarChart
          items={data.items || []}
          series="single"
          max={data.max}
        />
      );
      break;

    case 'bar-grouped':
      body = (
        <BarChart
          items={data.items || []}
          series="paired"
          currentLabel={data.currentLabel}
          targetLabel={data.targetLabel}
        />
      );
      break;

    case 'donut':
      body = <DonutChart slices={data.slices || []} />;
      break;

    case 'line':
      body = <LineChart points={data.points || []} range={data.range || '1M'} />;
      break;

    case 'treemap':
      body = <TreemapChart nodes={data.nodes || []} />;
      break;

    case 'scatter':
      body = (
        <ScatterChart points={data.points || []} xLabel={data.xLabel} yLabel={data.yLabel} />
      );
      break;

    case 'waterfall':
      body = <WaterfallChart steps={data.steps || []} />;
      break;

    case 'stat':
      body = <StatCallout value={data.value} context={data.context} />;
      break;

    default:
      // Unknown type — never render a partial or invented chart.
      return null;
  }

  if (!body) return null;

  return (
    <ChatChartFrame
      type={type}
      chartKey={key}
      title={title}
      subtitle={subtitle}
      footnote={footnote}
    >
      {body}
    </ChatChartFrame>
  );
}
