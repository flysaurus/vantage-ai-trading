'use client';

import { useEffect, useState } from 'react';
import { getMarketStatus, isMarketOpen } from '@/lib/market-hours';
import CompassIcon from './CompassIcon';

interface GreetingModalProps {
  onComplete: () => void;
}

function getMarketMessage(): string {
  const status = getMarketStatus();

  if (status.label === 'CLOSED') {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = et.getDay();
    if (day === 0 || day === 6) return 'Markets closed for the weekend.';
    return 'Markets are closed.';
  }

  if (status.label === 'PRE-MARKET') {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const timeInMinutes = hours * 60 + minutes;
    const minsToOpen = 570 - timeInMinutes;
    const h = Math.floor(minsToOpen / 60);
    const m = minsToOpen % 60;
    return h > 0
      ? `Markets open in ${h}h ${m}m.`
      : `Markets open in ${m} minutes.`;
  }

  if (status.label === 'OPEN') return 'Markets are open.';
  if (status.label === 'AFTER HOURS') return 'Markets closed. After-hours trading active.';

  return 'Markets are closed.';
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function GreetingModal({ onComplete }: GreetingModalProps) {
  const [isReady, setIsReady] = useState(false);
  const [phase, setPhase] = useState(0);
  const [userName, setUserName] = useState('');
  const [portfolioLine, setPortfolioLine] = useState('Your portfolio is ready.');
  const [portfolioColor, setPortfolioColor] = useState('white');
  const [marketStatus, setMarketStatus] = useState('');
  const [exiting, setExiting] = useState(false);

  // Fetch user + portfolio data (fires immediately)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [meRes, portfolioRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/portfolio/summary'),
        ]);

        const me = await meRes.json();
        const portfolio = await portfolioRes.json();

        // First initial only — auth/me wraps user under .user key
        const displayName = me.user?.displayName || me.displayName || '';
        const firstName: string = displayName.split(' ')[0] || '';
        const initial = firstName ? firstName[0].toUpperCase() : 'U';
        setUserName(initial);

        if (portfolio.isDemo) {
          setPortfolioLine('Your demo portfolio is ready.');
          setPortfolioColor('rgba(251,191,36,0.9)');
        } else if (portfolio.todayPnLPercent > 0) {
          setPortfolioLine(
            `Your portfolio is up ${portfolio.todayPnLPercent.toFixed(2)}% today.`,
          );
          setPortfolioColor('rgba(74,222,128,0.9)');
        } else if (portfolio.todayPnLPercent < 0) {
          setPortfolioLine(
            `Your portfolio is down ${Math.abs(portfolio.todayPnLPercent).toFixed(2)}% today.`,
          );
          setPortfolioColor('rgba(255,255,255,0.9)');
        }
      } catch {
        setUserName('');
        setPortfolioLine('Your portfolio is ready.');
      }

      // Signal data loaded — animation phases start
      setIsReady(true);
    };

    fetchData();

    const message = getMarketMessage();
    setMarketStatus(message);
  }, []);

  // Start animation phases only after data is loaded
  useEffect(() => {
    if (!isReady) return;

    const t1 = setTimeout(() => setPhase(1), 200);
    const t2 = setTimeout(() => setPhase(2), 600);
    const t3 = setTimeout(() => setPhase(3), 1000);
    const t4 = setTimeout(() => setPhase(4), 1600);
    const t5 = setTimeout(() => setPhase(5), 2000);
    const t6 = setTimeout(() => setExiting(true), 3000);
    // 0.8s for exit animation → onComplete at 3800ms
    const t7 = setTimeout(onComplete, 3800);

    return () => {
      [t1, t2, t3, t4, t5, t6, t7].forEach(clearTimeout);
    };
  }, [isReady, onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
      style={{
        backgroundColor: exiting ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.5)',
        transition: 'background-color 0.8s ease-out',
      }}
    >
      <div
        className="bg-slate-900/80 backdrop-blur-sm border border-white/10 rounded-3xl mx-6 w-full max-w-sm shadow-2xl"
        style={{
          opacity: exiting ? 0 : 1,
          transform: exiting ? 'translateY(-20px)' : 'translateY(0)',
          transition: 'all 0.8s ease-out',
        }}
      >
        <div className="flex flex-col items-center text-center px-8 pt-8 pb-10">
          {/* Compass — centered, 64px */}
          <div
            className="mb-5"
            style={{
              opacity: phase >= 1 ? 1 : 0,
              transform: phase >= 1 ? 'translateY(0)' : 'translateY(8px)',
              transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
            }}
          >
            <CompassIcon size={64} color="white" animated={false} settling={true} />
          </div>

          {/* Greeting */}
          <p
            className="text-white text-4xl font-light mb-0"
            style={{
              opacity: phase >= 2 ? 1 : 0,
              transform: phase >= 2 ? 'translateY(0)' : 'translateY(12px)',
              transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
            }}
          >
            {getGreeting()},
          </p>
          <p
            className="text-white text-4xl font-bold mb-6"
            style={{
              opacity: phase >= 3 ? 1 : 0,
              transform: phase >= 3 ? 'translateY(0)' : 'translateY(12px)',
              transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
            }}
          >
            {userName}.
          </p>

          {/* Status lines */}
          <p
            className="text-amber-400 text-base mb-2"
            style={{
              opacity: phase >= 4 ? 0.9 : 0,
              transition: 'opacity 0.4s ease-out',
            }}
          >
            {portfolioLine}
          </p>
          <p
            className="text-slate-400 text-base"
            style={{
              opacity: phase >= 5 ? 1 : 0,
              transition: 'opacity 0.4s ease-out',
            }}
          >
            {marketStatus}
          </p>
        </div>
      </div>
    </div>
  );
}
