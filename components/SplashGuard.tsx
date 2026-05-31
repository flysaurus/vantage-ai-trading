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

  if (!mounted) return <div style={{ position:'fixed',inset:0,background:'#000',zIndex:9999 }} />;

  if (show) return <SplashScreen onComplete={handleComplete} />;

  return <>{children}</>;
}
