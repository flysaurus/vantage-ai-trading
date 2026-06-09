'use client';

import { useEffect, useState } from 'react';

import { getMarketStatus } from '@/lib/market-hours';

interface GreetingModalProps {
  onComplete: () => void;
}

function getMarketMessage(): string {
  const { label } = getMarketStatus();
  switch (label) {
    case 'OPEN': return 'Markets are open.';
    case 'PRE-MARKET': return 'Pre-market trading active.';
    case 'AFTER HOURS': return 'Markets closed. After-hours trading active.';
    case 'CLOSED': return 'Markets are closed.';
    default: return 'Markets are closed.';
  }
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function GreetingModal({ onComplete }: GreetingModalProps) {
  const [isReady, setIsReady] = useState(false);
  const [userName, setUserName] = useState('');
  const [portfolioLine, setPortfolioLine] = useState('Your demo portfolio is ready.');
  const [portfolioColor, setPortfolioColor] = useState('amber');
  const [marketStatus, setMarketStatus] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [meRes, portfolioRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/portfolio/summary'),
        ]);

        const me = await meRes.json();
        const portfolio = await portfolioRes.json();

        const firstName: string = me.displayName?.split(' ')[0] || '';
        const initial = firstName ? firstName[0].toUpperCase() : '';
        setUserName(initial);

        if (portfolio.isDemo) {
          setPortfolioLine('Your demo portfolio is ready.');
          setPortfolioColor('amber');
        } else if (portfolio.todayPnLPercent > 0) {
          setPortfolioLine(
            `Your portfolio is up ${portfolio.todayPnLPercent.toFixed(2)}% today.`,
          );
          setPortfolioColor('green');
        } else if (portfolio.todayPnLPercent < 0) {
          setPortfolioLine(
            `Your portfolio is down ${Math.abs(portfolio.todayPnLPercent).toFixed(2)}% today.`,
          );
          setPortfolioColor('white');
        }
      } catch {
        setUserName('');
        setPortfolioLine('Your demo portfolio is ready.');
      }

      setIsReady(true);
    };

    fetchData();

    setMarketStatus(getMarketMessage());
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const t = setTimeout(onComplete, 3800);
    return () => clearTimeout(t);
  }, [isReady, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="bg-slate-900/95 rounded-3xl mx-8 w-full max-w-xs flex flex-col items-center text-center px-8" style={{ paddingTop: '54px', paddingBottom: '54px' }}>

        <div className="mb-8">
          <svg width="80" height="80" viewBox="0 -8 180 196">
            <circle cx="90" cy="90" r="82"
              fill="none" stroke="#22d3ee" strokeWidth="10" />
            <g style={{
              transform: 'rotate(0deg)',
              transformOrigin: '90px 90px'
            }}>
              <polygon points="90,18 98,90 90,108 82,90"
                fill="#22d3ee" />
              <polygon points="90,162 98,90 90,108 82,90"
                fill="#475569" />
              <circle cx="90" cy="90" r="5.5" fill="black" />
              <circle cx="90" cy="90" r="3" fill="#22d3ee" />
            </g>
            <text x="90" y="-4" textAnchor="middle"
              fill="#22d3ee" fontSize="16" fontWeight="700">N</text>
          </svg>
        </div>

        <p className="text-white font-light leading-tight mb-1" style={{ fontSize: '2.25rem' }}>
          {getGreeting()},
        </p>
        <p className="text-white font-bold leading-tight mb-8" style={{ fontSize: '2.25rem' }}>
          {userName || 'M'}.
        </p>

        <p className={`${portfolioColor === 'amber' ? 'text-amber-400' : portfolioColor === 'green' ? 'text-green-400' : 'text-white'} text-lg font-medium mb-2`}>
          {portfolioLine}
        </p>
        <p className="text-slate-400 text-base">
          {marketStatus}
        </p>
      </div>
    </div>
  );
}
