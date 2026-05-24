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
  },
];
