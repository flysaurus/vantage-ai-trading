'use client';
import { useState, useEffect } from 'react';
import CompassIcon from './CompassIcon';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [ringDrawn, setRingDrawn] = useState(false);
  const [roseVisible, setRoseVisible] = useState(false);
  const [animated, setAnimated] = useState(false);
  const [settling, setSettling] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timers = [
      // 200ms → ring drawing
      setTimeout(() => setRingDrawn(true), 200),
      // 900ms → rose + animated
      setTimeout(() => { setRoseVisible(true); setAnimated(true); }, 900),
      // 1100ms → settling (stop animating, start settle)
      setTimeout(() => { setAnimated(false); setSettling(true); }, 1100),
      // 1700ms → wordmark
      setTimeout(() => setTextVisible(true), 1700),
      // 2000ms → tagline
      setTimeout(() => setTaglineVisible(true), 2000),
      // 5000ms → exiting (2000 + 3000ms hold)
      setTimeout(() => setExiting(true), 5000),
      // 5400ms → onComplete()
      setTimeout(() => onComplete(), 5400),
    ];

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center transition-opacity duration-400 ${exiting ? 'opacity-0' : 'opacity-100'}`}>
      <div className="relative mb-8">
        {/* Ring SVG — 130px, r=63, circumference = 2*pi*63 ≈ 396 */}
        <svg
          width={130}
          height={130}
          viewBox="0 0 130 130"
          className="absolute inset-0"
        >
          <circle
            cx={65}
            cy={65}
            r={63}
            stroke="white"
            strokeWidth={3.5}
            fill="none"
            opacity={0.9}
            strokeDasharray={396}
            strokeDashoffset={ringDrawn ? 0 : 396}
            strokeLinecap="round"
            style={{
              transition: ringDrawn ? 'stroke-dashoffset 0.65s ease-out' : 'none',
              transformOrigin: 'center',
              transform: 'rotate(-90deg)',
            }}
          />
        </svg>

        {/* CompassIcon 130px — animates during display, then settles */}
        <div className={`transition-opacity duration-300 ${roseVisible ? 'opacity-100' : 'opacity-0'}`}>
          <CompassIcon size={130} color="white" animated={animated} settling={settling} />
        </div>
      </div>

      {/* Wordmark */}
      <div className={`transition-all duration-400 ${textVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        <p className="text-white text-2xl font-light tracking-[0.3em] uppercase mb-4">
          Vantage
        </p>
      </div>

      {/* Tagline — text-sm */}
      <div className={`transition-opacity duration-300 px-8 text-center ${taglineVisible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-slate-400 text-sm leading-relaxed tracking-wide">
          Institutional-quality AI portfolio analysis.<br />Built for everyone.
        </p>
      </div>

      {/* Spacer between tagline and version */}
      <div className="h-8" />

      {/* Version */}
      <div className={`transition-opacity duration-300 ${taglineVisible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-slate-600 text-xs tracking-wider">v0.1.0</p>
      </div>
    </div>
  );
}
