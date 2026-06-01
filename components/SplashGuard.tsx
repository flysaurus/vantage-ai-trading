'use client';
import { useState, useEffect } from 'react';
import SplashScreen from '@/components/SplashScreen';

export function SplashGuard({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (typeof sessionStorage !== 'undefined') {
        if (sessionStorage.getItem('vantage_splash_shown')) setShow(false);
      }
    } catch {}
  }, []);

  const handleComplete = () => {
    try { sessionStorage.setItem('vantage_splash_shown', 'true'); } catch {}
    setShow(false);
  };

  // SSR: render nothing (no black flash)
  if (!mounted) return null;

  return (
    <>
      {/* App content always rendered behind the splash */}
      {children}
      {/* Splash overlays on top — fade-out reveals children underneath */}
      {show && <SplashScreen onComplete={handleComplete} />}
    </>
  );
}
