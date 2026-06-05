'use client';
import { useState, useEffect } from 'react';
import CompassIcon from './CompassIcon';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [ringDrawn, setRingDrawn] = useState(false);
  const [roseVisible, setRoseVisible] = useState(false);
  const [settling, setSettling] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setRingDrawn(true), 200),
      setTimeout(() => setRoseVisible(true), 900),
      setTimeout(() => setSettling(true), 1100),
      setTimeout(() => setTextVisible(true), 1700),
      setTimeout(() => setTaglineVisible(true), 2000),
      setTimeout(() => setExiting(true), 2800),
      setTimeout(() => onComplete(), 3200),
    ];

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center transition-opacity duration-400 ${exiting ? 'opacity-0' : 'opacity-100'}`}>
      <div className="relative mb-8">
        <svg
          width={90}
          height={90}
          viewBox="0 0 90 90"
          className="absolute inset-0"
        >
          <circle
            cx={45}
            cy={45}
            r={43}
            stroke="white"
            strokeWidth={3.5}
            fill="none"
            opacity={0.9}
            strokeDasharray={270}
            strokeDashoffset={ringDrawn ? 0 : 270}
            strokeLinecap="round"
            style={{
              transition: ringDrawn ? 'stroke-dashoffset 0.65s ease-out' : 'none',
              transformOrigin: 'center',
              transform: 'rotate(-90deg)',
            }}
          />
        </svg>

        <div className={`transition-opacity duration-300 ${roseVisible ? 'opacity-100' : 'opacity-0'}`}>
          <CompassIcon size={90} color="white" animated={false} settling={settling} />
        </div>
      </div>

      <div className={`transition-all duration-400 ${textVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>
        <p className="text-white text-2xl font-light tracking-[0.25em] uppercase mb-3">
          Vantage
        </p>
      </div>

      <div className={`transition-opacity duration-300 px-8 text-center ${taglineVisible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-slate-500 text-xs leading-relaxed tracking-wide">
          Institutional-quality AI portfolio analysis.<br />Built for everyone.
        </p>
      </div>

      <div className={`absolute bottom-12 transition-opacity duration-300 ${taglineVisible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-slate-700 text-xs tracking-wider">v0.1.0</p>
      </div>
    </div>
  );
}
