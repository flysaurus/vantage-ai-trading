'use client';
import { useState, useEffect } from 'react';

interface SplashScreenProps { onComplete: () => void; }

const CHART_LEN = 210;
const VANTAGE = 'VANTAGE'.split('');

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [p, setP] = useState(0);
  const [skip, setSkip] = useState(false);
  const [tp, setTp] = useState<'idle' | 'vantage' | 'subtitle' | 'done'>('idle');

  useEffect(() => {
    const t = [50, 1500, 2200, 2800, 3600].map((ms, i) =>
      setTimeout(() => { setP(i + 1); if (i === 3) setTp('vantage'); }, ms),
    );
    const tDone = setTimeout(onComplete, 4000);
    return () => [...t, tDone].forEach(clearTimeout);
  }, [onComplete]);

  useEffect(() => {
    const t = setTimeout(() => setSkip(true), 1000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (tp === 'vantage') {
      const t = setTimeout(() => setTp('subtitle'), 400);
      return () => clearTimeout(t);
    }
    if (tp === 'subtitle') {
      const t = setTimeout(() => setTp('done'), 600);
      return () => clearTimeout(t);
    }
  }, [tp]);

  const ph = (n: number) => p >= n;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100dvh',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        opacity: ph(5) ? 0 : 1,
        transition: 'opacity .6s ease-in-out',
        pointerEvents: ph(5) ? 'none' : 'auto',
      }}
    >
      <style>{`
        @keyframes dP { to{stroke-dashoffset:0} }
        @keyframes fI { from{opacity:0} to{opacity:1} }
        @keyframes fL { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes foxFadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
        @keyframes aurora { 0%,100%{transform:scale(1) rotate(0deg);opacity:.2} 33%{transform:scale(1.15) rotate(8deg);opacity:.4} 66%{transform:scale(.95) rotate(-5deg);opacity:.15} }
        .chart .cl{stroke-dasharray:var(--l);stroke-dashoffset:var(--l);animation:dP .6s ease-in-out forwards}
        .li{opacity:0;animation:fL .3s ease-out forwards}
        .si{opacity:0;animation:fI .5s ease-out forwards}
        .sk{animation:fI .5s ease-out}
        .fox-fade-in{animation:foxFadeIn 1.2s ease-out forwards;opacity:0}
        .aurora-1{animation:aurora 4s ease-in-out infinite}
        .aurora-2{animation:aurora 5s ease-in-out infinite reverse}
        .aurora-3{animation:aurora 6s ease-in-out infinite 1s}
      `}</style>

      {/* ── Fox with aurora ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12, position: 'relative' }}>
        {/* Aurora glow layers */}
        <div
          className="aurora-1"
          style={{
            position: 'absolute',
            width: 192,
            height: 128,
            borderRadius: '50%',
            background: '#06b6d4',
            filter: 'blur(48px)',
            opacity: 0.2,
          }}
        />
        <div
          className="aurora-2"
          style={{
            position: 'absolute',
            width: 160,
            height: 112,
            borderRadius: '50%',
            background: '#9333ea',
            filter: 'blur(32px)',
            opacity: 0.15,
          }}
        />
        <div
          className="aurora-3"
          style={{
            position: 'absolute',
            width: 144,
            height: 96,
            borderRadius: '50%',
            background: '#14b8a6',
            filter: 'blur(24px)',
            opacity: 0.2,
          }}
        />

        {/* Fox emoji */}
        <span
          className={ph(1) ? 'fox-fade-in' : undefined}
          style={{
            fontSize: 96,
            lineHeight: 1,
            filter: 'drop-shadow(0 0 20px rgba(6,182,212,0.4))',
            position: 'relative',
            zIndex: 10,
            opacity: ph(1) ? undefined : 0,
          }}
        >
          🦊
        </span>
      </div>

      {/* ── Chart line ── */}
      <div style={{ width: 200, height: 50, marginTop: 8 }}>
        <svg viewBox="0 0 200 50" width={200} height={50} className={ph(3) ? 'chart' : ''}>
          <path
            d="M0 30 L60 32 L90 35 L130 20 L170 8 L200 5"
            fill="none"
            stroke="#06B6D4"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="cl"
            opacity={ph(3) ? 1 : 0}
            style={{
              '--l': CHART_LEN,
              transition: 'opacity .1s',
            } as React.CSSProperties}
          />
        </svg>
      </div>

      {/* ── Text ── */}
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <div
          style={{
            fontSize: 32,
            fontWeight: 200,
            letterSpacing: '.3em',
            color: '#fff',
            marginBottom: 10,
            minHeight: 42,
          }}
        >
          {tp !== 'idle' &&
            VANTAGE.map((l, i) => (
              <span
                key={i}
                className="li"
                style={{ animationDelay: `${i * 0.08}s`, display: 'inline-block' }}
              >
                {l}
              </span>
            ))}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 300,
            letterSpacing: '.2em',
            color: 'rgba(255,255,255,.5)',
            minHeight: 20,
          }}
        >
          {(tp === 'subtitle' || tp === 'done') && (
            <span className="si">AI Trading Intelligence</span>
          )}
        </div>
      </div>

      {/* ── Skip ── */}
      {skip && (
        <button
          onClick={onComplete}
          className="sk"
          style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,.3)',
            fontSize: 11,
            letterSpacing: '.2em',
            fontWeight: 400,
            cursor: 'pointer',
            fontFamily: 'inherit',
            textTransform: 'uppercase',
          }}
        >
          Skip
        </button>
      )}
    </div>
  );
}
