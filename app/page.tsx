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
import { SettingsTab } from '@/components/settings/SettingsTab';
import WatchlistTab from '@/components/ai/WatchlistTab';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { PortfolioProvider } from '@/context/PortfolioContext';
import { useAuth } from '@/components/providers/AuthProvider';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { BrokerGate } from '@/components/onboarding/BrokerGate';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import GreetingModal from '@/components/GreetingModal';

// Module-level: survives in-app navigation but resets on full page load (login)
let brokerGateDismissedThisSession = false;

const TABS_WITH_MARKETBAR: Set<TabId> = new Set(['ai', 'invest', 'portfolio']);

const TAB_COMPONENTS: Record<Exclude<TabId, 'ai'>, React.FC> = {
  invest: TradeTab,
  portfolio: PortfolioTab,
  watchlist: WatchlistTab,
  settings: SettingsTab,
};

function AppShell() {
  const { activeTab, setTab } = useTabStore();
  const { user, isDataLoaded } = useAuth();
  const { isConnected, isInitialized } = useBroker();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showBrokerGate, setShowBrokerGate] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [greeting, setGreeting] = useState('');
  const [showGreeting, setShowGreeting] = useState(false);
  const [showWelcomeToast, setShowWelcomeToast] = useState(false);
  const greetingShown = useRef(false);
  const [chatMessages, setChatMessages] = useState<
    { role: 'user' | 'ai'; content: string }[]
  >([]);

  // ── Greeting modal after login (detects fresh login via sessionStorage flag) ──
  useEffect(() => {
    if (!user || !isDataLoaded) return;
    if (showOnboarding || showBrokerGate) return;

    const fromLogin = sessionStorage.getItem('show_greeting');
    if (fromLogin === 'true') {
      sessionStorage.removeItem('show_greeting');
      greetingShown.current = true;
      // Show welcome toast at top of screen
      setShowWelcomeToast(true);
      setTimeout(() => setShowWelcomeToast(false), 3000);
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

  // ── Listen for cross-component navigation events ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab && ['portfolio', 'invest', 'ai', 'watchlist', 'settings'].includes(detail.tab)) {
        setTab(detail.tab);
      }
    };
    window.addEventListener('vantage-navigate', handler);
    return () => window.removeEventListener('vantage-navigate', handler);
  }, [setTab]);

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
          {greeting}
        </div>
      )}
      <Header />
      {TABS_WITH_MARKETBAR.has(activeTab) && <MarketBar />}
      <WatchlistBar />
      <div className="content-area" key={activeTab}>
        {activeTab === 'ai' ? (
          <AITab messages={chatMessages} setMessages={setChatMessages} />
        ) : (
          React.createElement(TAB_COMPONENTS[activeTab])
        )}
      </div>
      {!isDesktop && <BottomNav />}
    </>
  );

  return (
    <div className="app-shell">
      {isDesktop && <DesktopSidebar />}
      {isDesktop ? <div className="main-panel">{mainContent}</div> : mainContent}

      {/* Welcome-back toast — slides in from top on fresh login */}
      {showWelcomeToast && (() => {
        const initial = user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'M';
        return (
          <div style={{
            position: 'fixed',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99997,
            background: '#1a2235',
            border: '1px solid rgba(34,211,238,0.3)',
            borderRadius: '12px',
            padding: '12px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            animation: 'welcomeSlideDown 0.4s ease-out',
          }}>
            <span style={{ fontSize: '18px' }}>👋</span>
            <span style={{ color: '#ffffff', fontSize: '14px', fontWeight: '500' }}>
              Welcome back, {initial}.<br />
              <span style={{ color: '#22d3ee', fontSize: '12px' }}>Your portfolio is ready.</span>
            </span>
          </div>
        );
      })()}
      <style>{`
        @keyframes welcomeSlideDown {
          from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>

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
      <PortfolioProvider>
        <AppShell />
      </PortfolioProvider>
    </BrokerProvider>
  );
}
