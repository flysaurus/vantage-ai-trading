'use client';

import { useState, useEffect } from 'react';

interface AIThinkingIndicatorProps {
  mode?: string;
}

const STATUS_MESSAGES: Record<string, string[]> = {
  health: [
    'Analyzing your portfolio...',
    'Calculating risk scores...',
    'Checking style alignment...',
    'Running diagnostics...',
    'Almost there...',
  ],
  research: [
    'Fetching market data...',
    'Analyzing fundamentals...',
    'Reading technicals...',
    'Checking analyst ratings...',
    'Scoring sentiment...',
    'Building analysis...',
    'Almost there...',
  ],
  opportunities: [
    'Scanning for opportunities...',
    'Checking sector gaps...',
    'Analyzing oversold positions...',
    'Running opportunity scan...',
    'Almost there...',
  ],
  trends: [
    'Reading market conditions...',
    'Analyzing macro trends...',
    'Connecting to your portfolio...',
    'Almost there...',
  ],
  theme: [
    'Identifying theme stocks...',
    'Scoring candidates...',
    'Analyzing fundamentals...',
    'Checking technicals...',
    'Running sentiment analysis...',
    'Ranking by your style...',
    'Building basket...',
    'Almost there...',
  ],
  tax: [
    'Reading trade history...',
    'Calculating P&L...',
    'Identifying harvest opportunities...',
    'Almost there...',
  ],
  risk: [
    'Checking concentration...',
    'Analyzing sector exposure...',
    'Calculating risk metrics...',
    'Almost there...',
  ],
  general: [
    'Thinking...',
    'Analyzing...',
    'Almost there...',
  ],
};

export default function AIThinkingIndicator({
  mode = 'general',
}: AIThinkingIndicatorProps) {
  const messages =
    STATUS_MESSAGES[mode] || STATUS_MESSAGES.general;
  const [currentMessage, setCurrentMessage] = useState(messages[0]);
  const [isSlowResponse, setIsSlowResponse] = useState(false);

  // Rotate status messages
  useEffect(() => {
    setCurrentMessage(messages[0]);
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % messages.length;
      setCurrentMessage(messages[index]);
    }, 2000);
    return () => clearInterval(interval);
  }, [mode, messages]);

  // 30-second timeout safety net
  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsSlowResponse(true);
    }, 30000);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div className="flex items-start gap-3 mb-4">
      {/* Fox avatar */}
      <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 text-base animate-pulse">
        🦊
      </div>

      {/* Thinking bubble */}
      <div className="bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 max-w-xs">
        {/* Message */}
        <p className="text-sm text-slate-300 mb-3 transition-all duration-500">
          {currentMessage}
        </p>

        {/* Animated dots */}
        <div className="flex gap-1.5">
          {[0, 150, 300].map((delay, i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-cyan-400 animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>

      {/* Slow response notice */}
      {isSlowResponse && (
        <div className="absolute left-0 right-0 -bottom-6">
          <p className="text-xs text-slate-500 text-center">
            Deep analysis takes a moment — working through a lot of data...
          </p>
        </div>
      )}
    </div>
  );
}
