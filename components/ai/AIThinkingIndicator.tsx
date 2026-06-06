'use client';
import { useState, useEffect } from 'react';
import CompassIcon from '../CompassIcon';

const THINKING_MESSAGES: Record<string, string[]> = {
  health: ['Analyzing your portfolio', 'Calculating risk scores', 'Checking style alignment', 'Running diagnostics', 'Compiling results'],
  research: ['Fetching market data', 'Analyzing fundamentals', 'Reading technicals', 'Checking analyst ratings', 'Scoring sentiment', 'Building analysis'],
  opportunities: ['Scanning for opportunities', 'Checking sector gaps', 'Analyzing positions', 'Running opportunity scan'],
  market_pulse: ['Reading market conditions', 'Fetching earnings calendar', 'Checking analyst activity', 'Scanning news catalysts', 'Building your briefing'],
  trends: ['Reading market conditions', 'Analyzing macro trends', 'Connecting to your portfolio'],
  theme: ['Identifying theme stocks', 'Scoring candidates', 'Analyzing fundamentals', 'Checking technicals', 'Ranking by your style', 'Building basket'],
  tax: ['Reading trade history', 'Calculating P&L', 'Identifying harvest opportunities'],
  risk: ['Checking concentration', 'Analyzing sector exposure', 'Calculating risk metrics'],
  general: ['Analyzing', 'Reading your portfolio', 'Processing'],
};

export default function AIThinkingIndicator({ mode = 'general' }: { mode?: string }) {
  const messages = THINKING_MESSAGES[mode] || THINKING_MESSAGES.general;
  const [msgIndex, setMsgIndex] = useState(0);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % messages.length;
      setMsgIndex(i);
    }, 2000);
    return () => clearInterval(interval);
  }, [mode, messages.length]);

  return (
    <div className="flex items-center gap-3 py-2">
      <CompassIcon size={24} color="#22d3ee" animated={true} />
      <p className="text-slate-400 text-sm">
        {messages[msgIndex]} —
      </p>
    </div>
  );
}
