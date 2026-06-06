'use client';

import { useEffect, useState } from 'react';
import CompassIcon from '@/components/CompassIcon';

interface GreetingModalProps {
  onComplete: () => void;
}

function getMarketStatus(): { status: string; message: string } {
  const now = new Date();
  const et = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
  );
  const day = et.getDay();
  const hours = et.getHours();
  const minutes = et.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  if (day === 0 || day === 6) {
    return { status: 'closed', message: 'Markets closed for the weekend.' };
  }

  if (timeInMinutes >= 240 && timeInMinutes < 570) {
    const minsToOpen = 570 - timeInMinutes;
    const h = Math.floor(minsToOpen / 60);
    const m = minsToOpen % 60;
    return {
      status: 'premarket',
      message:
        h > 0
          ? `Markets open in ${h}h ${m}m.`
          : `Markets open in ${m} minutes.`,
    };
  }

  if (timeInMinutes >= 570 && timeInMinutes < 960) {
    return { status: 'open', message: 'Markets are open.' };
  }

  if (timeInMinutes >= 960 && timeInMinutes < 1200) {
    return {
      status: 'afterhours',
      message: 'Markets closed. After-hours trading active.',
    };
  }

  return { status: 'closed', message: 'Markets are closed.' };
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

    const { message } = getMarketStatus();
    setMarketStatus(message);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    const t = setTimeout(onComplete, 3800);
    return () => clearTimeout(t);
  }, [isReady, onComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">
      <div className="bg-slate-900/95 rounded-3xl mx-8 w-full max-w-xs flex flex-col items-center text-center px-8 pt-10 pb-10">

        <div className="mb-8">
          <CompassIcon size={80} color="white" animated={false} settling={true} />
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
