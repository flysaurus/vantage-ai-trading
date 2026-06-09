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

      {/* Compass with sweeping needle and fading trail */}
      <div className="relative mb-10">
        <svg width="80" height="80" viewBox="0 0 80 80">

          {/* Outer ring */}
          <circle
            cx="40" cy="40" r="36"
            fill="none"
            stroke="#1e3a5f"
            strokeWidth="1.5"
          />

          {/* Fading trail arc — 8 segments with decreasing opacity */}
          {[...Array(8)].map((_, i) => {
            const segmentAngle = 15; // 120 / 8
            const startDeg = angle - 120 + (i * segmentAngle);
            const endDeg = startDeg + segmentAngle;
            const opacity = (i + 1) / 8; // 0.125 to 1.0
            const startRad = (startDeg - 90) * Math.PI / 180;
            const endRad = (endDeg - 90) * Math.PI / 180;
            const r = 36;
            const cx = 40, cy = 40;
            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);
            const largeArc = segmentAngle > 180 ? 1 : 0;
            return (
              <path
                key={i}
                d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2.5"
                strokeLinecap="round"
                opacity={opacity * (angle > 0 ? 1 : 0)}
                style={{
                  transition: 'opacity 0.1s'
                }}
              />
            );
          })}

          {/* Needle — north point (dominant, tall) */}
          <g
            style={{
              transform: `rotate(${angle}deg)`,
              transformOrigin: '40px 40px',
              transition: returning
                ? 'transform 0.8s ease-in-out'
                : 'transform 1.5s ease-out'
            }}
          >
            {/* North point — cyan, tall */}
            <polygon
              points="40,8 43,40 40,46 37,40"
              fill="#22d3ee"
            />
            {/* South point — slate, short */}
            <polygon
              points="40,72 43,40 40,46 37,40"
              fill="#334155"
            />
            {/* Center dot */}
            <circle cx="40" cy="40" r="3" fill="#0f172a" />
            <circle cx="40" cy="40" r="1.5" fill="#22d3ee" />
          </g>

          {/* Cardinal points */}
          <text x="40" y="6" textAnchor="middle"
            fill="#22d3ee" fontSize="8" fontWeight="700">N</text>
          <text x="40" y="77" textAnchor="middle"
            fill="#475569" fontSize="6">S</text>
          <text x="76" y="43" textAnchor="middle"
            fill="#475569" fontSize="6">E</text>
          <text x="4" y="43" textAnchor="middle"
            fill="#475569" fontSize="6">W</text>

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
