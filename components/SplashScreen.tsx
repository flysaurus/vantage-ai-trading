'use client';
import { useState, useEffect } from 'react';
import { Compass as CompassIcon } from 'lucide-react';

interface SplashScreenProps { onComplete: () => void; }

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const tFade = setTimeout(() => setExiting(true), 6000);
    const tDone = setTimeout(onComplete, 6800);
    return () => { clearTimeout(tFade); clearTimeout(tDone); };
  }, [onComplete]);

  return (
    <div className={`fixed inset-0 z-50 bg-black flex flex-col items-center justify-center ${exiting ? 'opacity-0' : 'opacity-100'} transition-opacity duration-400`}>
      {/* Compass */}
      <div className="mb-10">
        <CompassIcon size={130} color="white" strokeWidth={1} />
      </div>

      {/* VANTAGE wordmark */}
      <p className="text-white text-2xl font-light tracking-[0.3em] uppercase mb-12">
        Vantage
      </p>

      {/* Tagline */}
      <p className="text-slate-400 text-sm leading-relaxed tracking-wide text-center px-10">
        Institutional-quality AI portfolio analysis.<br />Built for everyone.
      </p>

      {/* Version — pinned to bottom, centered */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <p className="text-slate-600 text-xs tracking-wider">
          v0.1.0
        </p>
      </div>
    </div>
  );
}
