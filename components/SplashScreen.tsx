'use client';
import { useState, useEffect } from 'react';
import CompassIcon from '@/components/CompassIcon';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [ringDrawn, setRingDrawn] = useState(false);
  const [roseVisible, setRoseVisible] = useState(false);
  const [needleAnimating, setNeedleAnimating] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t = [
      setTimeout(() => setRingDrawn(true), 200),
      setTimeout(() => {
        setRoseVisible(true);
        setNeedleAnimating(true);
      }, 900),
      // Needle animation runs internally for ~2.4s (1.2s sway out + 1.2s return)
      setTimeout(() => setTextVisible(true), 1800),
      setTimeout(() => setTaglineVisible(true), 2100),
      // Hold 3 full seconds after tagline
      setTimeout(() => setExiting(true), 5200),
      setTimeout(() => onComplete(), 5600),
    ];
    return () => t.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center transition-opacity duration-500 ${exiting ? 'opacity-0' : 'opacity-100'}`}>

      {/* Compass 130px */}
      <div className="relative mb-10">
        {/* Ring draws itself */}
        <svg width={130} height={130} viewBox="0 0 130 130" className="absolute inset-0">
          <circle
            cx={65} cy={65} r={62}
            stroke="white"
            strokeWidth={4}
            fill="none"
            opacity={0.95}
            strokeDasharray={389}
            strokeDashoffset={ringDrawn ? 0 : 389}
            strokeLinecap="round"
            style={{
              transition: ringDrawn ? 'stroke-dashoffset 0.7s ease-out' : 'none',
              transformOrigin: 'center',
              transform: 'rotate(-90deg)',
            }}
          />
        </svg>

        {/* Rose — fades in, then settles */}
        <div className={`transition-opacity duration-300 ${roseVisible ? 'opacity-100' : 'opacity-0'}`}>
          <CompassIcon size={130} color="white" animated={needleAnimating} />
        </div>
      </div>

      {/* VANTAGE wordmark */}
      <div className={`transition-all duration-500 ${textVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'}`}>
        <p className="text-white text-2xl font-light tracking-[0.3em] uppercase mb-4">
          Vantage
        </p>
      </div>

      {/* Tagline */}
      <div className={`transition-opacity duration-400 px-10 text-center ${taglineVisible ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-slate-400 text-sm leading-relaxed tracking-wide">
          Institutional-quality AI portfolio analysis.<br />Built for everyone.
        </p>
      </div>

      {/* Version pinned to bottom */}
      <div className="absolute bottom-10">
        <p className="text-slate-700 text-xs tracking-wider">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
