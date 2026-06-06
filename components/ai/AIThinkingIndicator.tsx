'use client';
import { useState, useEffect } from 'react';
import CompassIcon from '@/components/CompassIcon';

const MESSAGES: Record<string, string[]> = {
  health: [
    'Analyzing your portfolio',
    'Calculating risk scores',
    'Checking style alignment',
    'Running diagnostics',
    'Compiling results',
  ],
  research: [
    'Fetching market data',
    'Analyzing fundamentals',
    'Reading technicals',
    'Checking analyst ratings',
    'Scoring sentiment',
  ],
  opportunities: [
    'Scanning for opportunities',
    'Checking sector gaps',
    'Running opportunity scan',
  ],
  market_pulse: [
    'Reading market conditions',
    'Fetching earnings calendar',
    'Checking analyst activity',
    'Scanning news catalysts',
  ],
  theme: [
    'Identifying theme stocks',
    'Scoring candidates',
    'Analyzing fundamentals',
    'Ranking by your style',
    'Building basket',
  ],
  tax: [
    'Reading trade history',
    'Calculating P&L',
    'Identifying harvest opportunities',
  ],
  risk: [
    'Checking concentration',
    'Analyzing sector exposure',
    'Calculating risk metrics',
  ],
  general: [
    'Analyzing',
    'Reading your portfolio',
    'Processing',
  ],
  alerts: [
    'Scanning price moves',
    'Checking upcoming events',
    'Analyzing concentration',
    'Looking for risks',
    'Compiling alerts',
  ],
};

export default function AIThinkingIndicator({ mode = 'general' }: { mode?: string }) {
  const messages = MESSAGES[mode] || MESSAGES.general;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setIdx(i);
    }, 2000);
    return () => clearInterval(interval);
  }, [mode, messages.length]);

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <CompassIcon size={22} color="white" animated={true} />
      <p className="text-slate-400 text-sm">
        {messages[idx]} —
      </p>
    </div>
  );
}
