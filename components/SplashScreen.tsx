'use client';
import { useState, useEffect } from 'react';

export default function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [angle, setAngle] = useState(0);
  const [returning, setReturning] = useState(false);
  const [textVisible, setTextVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Start sweep after 400ms
    const t1 = setTimeout(() => setAngle(120), 400);
    // Return to north after sweep + 300ms pause (400 + 2500 + 300 = 3200)
    const t2 = setTimeout(() => {
      setReturning(true);
      setAngle(0);
    }, 3200);
    // Hide splash after return + 2s display (3200 + 1200 + 1600 = 6000)
    const t3 = setTimeout(() => onComplete(), 6000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  useEffect(() => {
    const t = [
      setTimeout(() => setTextVisible(true), 2000),
      setTimeout(() => setTaglineVisible(true), 2400),
      // Fade out just before splash dismisses
      setTimeout(() => setExiting(true), 5500),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center transition-opacity duration-500 ${exiting ? 'opacity-0' : 'opacity-100'}`}>

      {/* Compass with sweeping needle */}
      <div className="relative" style={{ marginBottom: '40px' }}>
        <svg width="360" height="360" viewBox="0 0 360 360">

          {/* Outer ring */}
          <circle
            cx="180" cy="180" r="164"
            fill="none"
            stroke="white"
            strokeWidth="4"
          />

          {/* Needle — north point (dominant, tall) */}
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: '180px 180px',
              transition: returning
                ? 'transform 1.2s ease-in-out'
                : 'transform 2.5s ease-out'
            }}
          >
            {/* North point — cyan, tall */}
            <polygon
              points="180,36 196,180 180,216 164,180"
              fill="#22d3ee"
            />
            {/* South point — slate, short */}
            <polygon
              points="180,324 196,180 180,216 164,180"
              fill="#334155"
            />
            {/* Center dot */}
            <circle cx="180" cy="180" r="11" fill="black" />
            <circle cx="180" cy="180" r="6" fill="#22d3ee" />
          </g>

          {/* N label */}
          <text x="180" y="24" textAnchor="middle"
            fill="white" fontSize="20" fontWeight="600">N</text>

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
