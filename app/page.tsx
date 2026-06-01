'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { OrdersTab } from '@/components/orders/OrdersTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { BrokerGate } from '@/components/onboarding/BrokerGate';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import GreetingModal from '@/components/GreetingModal';

// Module-level: survives in-app navigation but resets on full page load (login)
let brokerGateDismissedThisSession = false;

const TAB_COMPONENTS: Record<TabId, React.FC> = {
  ai: AITab,
  trade: TradeTab,
  portfolio: PortfolioTab,
  orders: OrdersTab,
  settings: SettingsTab,
};

function AppShell() {
  const { activeTab } = useTabStore();
  const { user, isDataLoaded } = useAuth();
  const { isConnected, isInitialized } = useBroker();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showBrokerGate, setShowBrokerGate] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [showGreeting, setShowGreeting] = useState(false);
  const greetingShown = useRef(false);

  // ── Greeting modal after login (detects fresh login via sessionStorage flag) ──
  useEffect(() => {
    if (!user || !isDataLoaded) return;
    if (showOnboarding || showBrokerGate) return;

    const fromLogin = sessionStorage.getItem('show_greeting');
    if (fromLogin === 'true') {
      sessionStorage.removeItem('show_greeting');
      greetingShown.current = true;
      // Short delay to let the main app render fully behind the modal
      setTimeout(() => setShowGreeting(true), 300);
    }
  }, [user, isDataLoaded, showOnboarding, showBrokerGate]);

  // ── Welcome greeting banner (suppressed if modal shown) ──
  useEffect(() => {
    if (!user || !isDataLoaded) return;
    if (greetingShown.current) return; // modal handles greeting
    const name = user.displayName || user.email?.split('@')[0] || '';
    const initial = name.charAt(0).toUpperCase();
    const hour = new Date().getHours();
    const timeGreeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const phrases = [
      `${timeGreeting}, ${initial}!`,
      `Welcome back, ${initial}!`,
      `Ready to make some money, ${initial}?`,
      `Ready for a quick review, ${initial}!`,
    ];
    setGreeting(phrases[Math.floor(Math.random() * phrases.length)]);
    const timer = setTimeout(() => setGreeting(''), 4000);
    return () => clearTimeout(timer);
  }, [user, isDataLoaded]);

  // Detect desktop width
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Step 1: Style onboarding check
  useEffect(() => {
    if (!user || !isDataLoaded) return;

    if (user.investorStyleOnboarded) {
      setShowOnboarding(false);
      return;
    }

    if (typeof window !== 'undefined') {
      localStorage.removeItem('vantage:onboarded');
    }

    setShowOnboarding(true);
  }, [user, isDataLoaded]);

  // Step 2: Broker gate — if onboarded but no broker, show gate every login.
  // Gate stays dismissed for the rest of the session (survives in-app navigation).
  useEffect(() => {
    if (!user || !isDataLoaded || showOnboarding) return;
    if (!isInitialized) return; // still checking /api/broker/status

    if (!isConnected && !brokerGateDismissedThisSession) {
      setShowBrokerGate(true);
    }
  }, [user, isDataLoaded, showOnboarding, isInitialized, isConnected]);

  // 🔒 HARD GATE: Don't render ANY dashboard content until DB profile is confirmed.
  if (!isDataLoaded || !user) {
    return null;
  }

  // Wait for broker status check before rendering anything.
  // Prevents dashboard flicker when broker gate needs to appear.
  if (!isInitialized) {
    return null;
  }

  // Onboarding overlay
  if (showOnboarding) {
    return <InvestorStyleOnboarding />;
  }

  // Broker gate — shown every login until broker is connected.
  // Dismissed for session via module-level variable.
  if (showBrokerGate) {
    return (
      <BrokerGate
        onDismiss={() => {
          setShowBrokerGate(false);
          brokerGateDismissedThisSession = true;
        }}
      />
    );
  }

  const mainContent = (
    <>
      {greeting && (
        <div
          style={{
            textAlign: 'center',
            padding: '10px 16px',
            background: 'linear-gradient(135deg, #06b6d4, #0d9488)',
            color: '#0f172a',
            fontSize: 14,
            fontWeight: 700,
            animation: 'fadeInDown 0.4s ease-out, fadeOut 0.5s ease-in 3.5s forwards',
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          🦊 {greeting}
        </div>
      )}
      <Header />
      <MarketBar />
      <WatchlistBar />
      <div className="content-area" key={activeTab}>
        {React.createElement(TAB_COMPONENTS[activeTab])}
      </div>
      {!isDesktop && <BottomNav />}
    </>
  );

  return (
    <div className="app-shell">
      {isDesktop && <DesktopSidebar />}
      {isDesktop ? <div className="main-panel">{mainContent}</div> : mainContent}

      {/* Greeting modal — renders OVER fully loaded app with backdrop blur */}
      {showGreeting && (
        <GreetingModal
          onComplete={() => setShowGreeting(false)}
        />
      )}
    </div>
  );
}

export default function Home() {
  return (
    <BrokerProvider>
      <AppShell />
    </BrokerProvider>
  );
}
