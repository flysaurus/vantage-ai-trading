'use client';

import { useEffect, useState } from 'react';

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
  const [phase, setPhase] = useState(0);
  const [userName, setUserName] = useState('');
  const [portfolioLine, setPortfolioLine] = useState('Your portfolio is ready.');
  const [portfolioColor, setPortfolioColor] = useState('white');
  const [marketStatus, setMarketStatus] = useState('');

  useEffect(() => {
    // Fetch user + portfolio data
    const fetchData = async () => {
      try {
        const [meRes, portfolioRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/portfolio/summary'),
        ]);

        const me = await meRes.json();
        const portfolio = await portfolioRes.json();

        // First initial only
        const firstName: string = me.displayName?.split(' ')[0] || '';
        const initial = firstName ? firstName[0].toUpperCase() : '';
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
    };

    fetchData();

    const { message } = getMarketStatus();
    setMarketStatus(message);

    // Animation phases
    const t1 = setTimeout(() => setPhase(1), 200);
    const t2 = setTimeout(() => setPhase(2), 600);
    const t3 = setTimeout(() => setPhase(3), 900);
    const t4 = setTimeout(() => setPhase(4), 1400);
    const t5 = setTimeout(() => setPhase(5), 1700);
    const t6 = setTimeout(() => setPhase(6), 2500);
    const t7 = setTimeout(onComplete, 3000);

    return () => [t1, t2, t3, t4, t5, t6, t7].forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center px-8"
      style={{
        opacity: phase === 6 ? 0 : 1,
        transition: phase === 6 ? 'opacity 0.4s ease-out' : 'none',
      }}
    >
      {/* Fox */}
      <div
        style={{
          fontSize: '48px',
          marginBottom: '32px',
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
        }}
      >
        🦊
      </div>

      {/* Greeting */}
      <div
        style={{
          fontSize: 'clamp(32px, 8vw, 48px)',
          fontWeight: 200,
          color: 'white',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          textAlign: 'center',
          opacity: phase >= 2 ? 1 : 0,
          transform: phase >= 2 ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
        }}
      >
        {getGreeting()},
      </div>

      {/* Name (initial only) */}
      <div
        style={{
          fontSize: 'clamp(32px, 8vw, 48px)',
          fontWeight: 600,
          color: 'white',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          textAlign: 'center',
          marginBottom: '24px',
          opacity: phase >= 3 ? 1 : 0,
          transform: phase >= 3 ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.5s ease-out, transform 0.5s ease-out',
        }}
      >
        {userName}.
      </div>

      {/* Portfolio line */}
      <div
        style={{
          fontSize: '16px',
          fontWeight: 300,
          color: portfolioColor,
          textAlign: 'center',
          opacity: phase >= 4 ? 0.9 : 0,
          transition: 'opacity 0.4s ease-out',
        }}
      >
        {portfolioLine}
      </div>

      {/* Market status */}
      <div
        style={{
          fontSize: '14px',
          fontWeight: 300,
          color: 'rgba(255,255,255,0.45)',
          textAlign: 'center',
          marginTop: '8px',
          opacity: phase >= 5 ? 1 : 0,
          transition: 'opacity 0.4s ease-out',
        }}
      >
        {marketStatus}
      </div>
    </div>
  );
}
