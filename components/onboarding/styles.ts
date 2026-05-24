'use client';

import React from 'react';
import type { InvestorStyle } from '@/types';

// ─── Style Definitions ────────────────────────────────────────

export interface StyleDef {
  id: InvestorStyle;
  name: string;
  emoji: string;
  title: string;
  description: string;
  timeHorizon: string;
  philosophy: string;
  means: string[];
}

export const INVESTOR_STYLES: StyleDef[] = [
  {
    id: 'buffett',
    name: 'Warren Buffett',
    emoji: '💎',
    title: 'The Value Hunter',
    description: 'Buy quality companies at fair prices, hold for decades',
    timeHorizon: '5-10+ years',
    philosophy:
      'Buy quality companies at attractive prices and hold for 5-10+ years to compound wealth through dividends.',
    means: [
      'Focus on dividend-paying quality stocks',
      'Look for low P/E valuations',
      'Hold long-term, minimize trading',
      'Avoid speculative trades',
    ],
  },
  {
    id: 'lynch',
    name: 'Peter Lynch',
    emoji: '📈',
    title: 'The Growth Chaser',
    description: 'Growing companies at reasonable prices',
    timeHorizon: '2-5 years',
    philosophy:
      'Find growing companies trading at reasonable valuations. Hold for 2-5 years while growth persists, then rotate to new winners.',
    means: [
      'Find companies with 15%+ revenue growth',
      'Trade at reasonable multiples relative to growth',
      'Rotate to new winners as growth slows',
      'Balanced risk approach',
    ],
  },
  {
    id: 'livermore',
    name: 'Jesse Livermore',
    emoji: '⚡️',
    title: 'The Momentum Rider',
    description: 'Follow the trend, trade active, exit fast',
    timeHorizon: 'Days-6 months',
    philosophy:
      'Follow technical trends, ride momentum up, exit quickly on reversal. Active trader mentality (days-6 months).',
    means: [
      'Follow price trends and moving averages',
      'Trade actively (days-6 months)',
      'Cut losers quickly with stop-losses',
      'Exit winners when momentum breaks',
    ],
  },
  {
    id: 'soros',
    name: 'George Soros',
    emoji: '🌍',
    title: 'The Macro Strategist',
    description: 'Big picture positioning, adapt to market regime',
    timeHorizon: '6-18 months',
    philosophy:
      "Position for what's coming next based on macro trends. Think about interest rates, inflation, sector rotation (6-18 months).",
    means: [
      'Monitor interest rates, inflation, recession risk',
      'Rotate sectors based on macro outlook',
      'Position early in market cycles',
      'Adapt to changing economic regimes',
    ],
  },
  {
    id: 'munger',
    name: 'Charlie Munger',
    emoji: '💰',
    title: 'The Dividend Compounder',
    description: 'Reliable income and modest growth over decades',
    timeHorizon: '10+ years',
    philosophy:
      'Build wealth through consistent dividend income that compounds over 10+ years. Focus on stable, income-generating businesses.',
    means: [
      'Focus on dividend-paying stocks',
      'Dividend must grow 5-7% annually',
      'Hold 10+ years (true compounder)',
      'Emphasize stability & income',
    ],
  },
];
