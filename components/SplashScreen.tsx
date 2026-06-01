'use client';
import { useState, useEffect } from 'react';

interface SplashScreenProps { onComplete: () => void; }

const VANTAGE = 'VANTAGE'.split('');

// ── Stable particle configs (computed once at module load) ──
const PARTICLES = Array.from({ length: 25 }, (_, i) => ({
  id: i,
  left: `${Math.random() * 100}%`,
  delay: `${Math.random() * 8}s`,
  duration: `${8 + Math.random() * 6}s`,
  size: Math.random() > 0.7 ? 2 : 1,
  opacity: 0.08 + Math.random() * 0.12,
}));

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [p, setP] = useState(0);
  const [skip, setSkip] = useState(false);
  const [tp, setTp] = useState<'idle' | 'vantage' | 'subtitle' | 'done'>('idle');

  useEffect(() => {
    const t = [50, 1500, 2200, 2800, 3600].map((ms, i) =>
      setTimeout(() => { setP(i + 1); if (i === 3) setTp('vantage'); }, ms),
    );
    const tDone = setTimeout(onComplete, 7500);
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
        @keyframes fI { from{opacity:0} to{opacity:1} }
        @keyframes fL { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes foxFadeIn { from{opacity:0;transform:scale(0.8)} to{opacity:1;transform:scale(1)} }
        @keyframes aurora { 0%,100%{transform:scale(1) rotate(0deg);opacity:.2} 33%{transform:scale(1.15) rotate(8deg);opacity:.4} 66%{transform:scale(.95) rotate(-5deg);opacity:.15} }
        @keyframes particleFloat {
          0%{transform:translateY(0) translateX(0);opacity:0}
          10%{opacity:var(--opacity,0.1)}
          90%{opacity:var(--opacity,0.1)}
          100%{transform:translateY(-100vh) translateX(20px);opacity:0}
        }
        @keyframes drawLine { to{stroke-dashoffset:0} }
        @keyframes fadeInArea { to{opacity:1} }
        @keyframes linePulse { 0%,100%{opacity:.3;stroke-width:1} 50%{opacity:.8;stroke-width:2} }
        @keyframes popIn { 0%{opacity:0;r:0} 60%{opacity:1;r:4} 100%{opacity:1;r:2.5} }

        .li{opacity:0;animation:fL .3s ease-out forwards}
        .si{opacity:0;animation:fI .5s ease-out forwards}
        .sk{animation:fI .5s ease-out}
        .fox-fade-in{animation:foxFadeIn 1.2s ease-out forwards;opacity:0}
        .aurora-1{animation:aurora 4s ease-in-out infinite}
        .aurora-2{animation:aurora 5s ease-in-out infinite reverse}
        .aurora-3{animation:aurora 6s ease-in-out infinite 1s}
        .aurora-4{animation:aurora 7s ease-in-out infinite 2s reverse}
        .particle-float{animation:particleFloat linear infinite;opacity:0}
        .v-line-draw{stroke-dasharray:400;stroke-dashoffset:400;animation:drawLine .8s ease-out forwards}
        .v-line-pulse{stroke-dasharray:400;stroke-dashoffset:400;animation:drawLine .8s ease-out forwards, linePulse 2s ease-in-out 1s infinite}
        .area-fill{opacity:0;animation:fadeInArea .6s ease-out .8s forwards}
        .data-point{opacity:0}
        .dp-1{animation:popIn .3s ease-out .3s forwards}
        .dp-2{animation:popIn .3s ease-out .6s forwards}
        .dp-3{animation:popIn .3s ease-out .9s forwards}
      `}</style>

      {/* ── Floating particles (behind everything) ── */}
      {ph(1) && (
        <div className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
          {PARTICLES.map((p) => (
            <div
              key={p.id}
              className="absolute rounded-full bg-white particle-float"
              style={{
                left: p.left,
                bottom: '-4px',
                width: `${p.size}px`,
                height: `${p.size}px`,
                '--opacity': String(p.opacity),
                animationDelay: p.delay,
                animationDuration: p.duration,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}

      {/* ── Fox with aurora ── */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <div className="absolute" style={{ inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="aurora-1" style={{ position: 'absolute', width: 256, height: 160, borderRadius: '50%', background: '#06b6d4', filter: 'blur(64px)', opacity: 0.15 }} />
          <div className="aurora-2" style={{ position: 'absolute', width: 192, height: 128, borderRadius: '50%', background: '#9333ea', filter: 'blur(48px)', opacity: 0.2, transform: 'translate(20px, -10px)' }} />
          <div className="aurora-3" style={{ position: 'absolute', width: 224, height: 144, borderRadius: '50%', background: '#2dd4bf', filter: 'blur(64px)', opacity: 0.1, transform: 'translate(-15px, 10px)' }} />
          <div className="aurora-4" style={{ position: 'absolute', width: 160, height: 112, borderRadius: '50%', background: '#6366f1', filter: 'blur(48px)', opacity: 0.15, transform: 'translate(10px, 15px)' }} />
        </div>

        <span
          className={ph(1) ? 'fox-fade-in' : undefined}
          style={{
            fontSize: 120,
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

      {/* ── V chart (gradient + area fill + data points) ── */}
      <div style={{ width: 240, height: 60, marginTop: 8 }}>
        <svg width={240} height={60} viewBox="0 0 240 60">
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#06B6D4" />
              <stop offset="50%" stopColor="#7C3AED" />
              <stop offset="100%" stopColor="#0D9488" />
            </linearGradient>
            <filter id="lineGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {ph(3) && (
            <>
              <path d="M0 45 L80 45 L120 20 L240 5 L240 60 L0 60 Z" fill="url(#areaGradient)" className="area-fill" />
              <path d="M0 45 L80 45 L120 20 L240 5" fill="none" stroke="url(#lineGradient)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" filter="url(#lineGlow)" className="v-line-draw" />
              <path d="M0 45 L80 45 L120 20 L240 5" fill="none" stroke="#06B6D4" strokeWidth="1" strokeLinecap="round" opacity="0.5" className="v-line-pulse" />
              <circle cx="0" cy="45" r="2.5" fill="#06B6D4" className="data-point dp-1" />
              <circle cx="120" cy="20" r="2.5" fill="#7C3AED" className="data-point dp-2" />
              <circle cx="240" cy="5" r="2.5" fill="#0D9488" className="data-point dp-3" />
            </>
          )}
        </svg>
      </div>

      {/* ── Text ── */}
      <div style={{ marginTop: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 200, letterSpacing: '.3em', color: '#fff', marginBottom: 10, minHeight: 42 }}>
          {tp !== 'idle' &&
            VANTAGE.map((l, i) => (
              <span key={i} className="li" style={{ animationDelay: `${i * 0.08}s`, display: 'inline-block' }}>
                {l}
              </span>
            ))}
        </div>
        <div style={{ fontSize: 13, fontWeight: 300, letterSpacing: '.2em', color: 'rgba(255,255,255,.5)', minHeight: 20 }}>
          {(tp === 'subtitle' || tp === 'done') && <span className="si">AI Trading Intelligence</span>}
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
