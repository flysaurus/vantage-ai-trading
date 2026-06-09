'use client';
import { useState, useEffect } from 'react';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [angle, setAngle] = useState(0);
  const [returning, setReturning] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Start sweep after 300ms
    const t1 = setTimeout(() => setAngle(120), 300);
    // Return to north after sweep completes
    const t2 = setTimeout(() => {
      setReturning(true);
      setAngle(0);
    }, 1800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    const t = [
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

      {/* Compass with sweeping needle */}
      <div className="relative" style={{ marginBottom: '36px' }}>
        <svg width="180" height="180" viewBox="0 0 180 180">

          {/* Outer ring */}
          <circle
            cx="90" cy="90" r="82"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="4"
          />

          {/* Needle — north point (dominant, tall) */}
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: '90px 90px',
              transition: returning
                ? 'transform 0.8s ease-in-out'
                : 'transform 1.5s ease-out'
            }}
          >
            {/* North point — cyan, tall */}
            <polygon
              points="90,18 98,90 90,108 82,90"
              fill="#22d3ee"
            />
            {/* South point — slate, short */}
            <polygon
              points="90,162 98,90 90,108 82,90"
              fill="#334155"
            />
            {/* Center dot */}
            <circle cx="90" cy="90" r="5.5" fill="#0f172a" />
            <circle cx="90" cy="90" r="3" fill="#22d3ee" />
          </g>

          {/* N label */}
          <text x="90" y="12" textAnchor="middle"
            fill="#22d3ee" fontSize="18" fontWeight="700">N</text>

        </svg>
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
