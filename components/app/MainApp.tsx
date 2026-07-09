// ─── Main App Shell ────────────────────────────────────────
// The full authenticated app experience.
// Contains: header, tabs, portfolio, watchlists, broker gate,
// greeting modal, email gate, player status, etc.
//
// Extracted from app/page.tsx to keep the root page as a
// clean routing layer (no React #310 hooks-before-returns violations).

'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { DesktopSidebar } from '@/components/layout/DesktopSidebar';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { PlayerStatusBar } from '@/components/gamification/PlayerStatusBar';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import WatchlistTab from '@/components/ai/WatchlistTab';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { PortfolioProvider, useLivePortfolio } from '@/context/PortfolioContext';
import { onDailyOpen } from '@/lib/gamification/events';
import { useAppState } from '@/lib/app-state';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { BrokerGate } from '@/components/onboarding/BrokerGate';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import GreetingModal from '@/components/GreetingModal';
import { DemoWarningBanner } from '@/components/DemoWarningBanner';
import { getDemoStatus } from '@/lib/demo-utils';

import type { User } from '@/types';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';

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
  const { state, user: supabaseUser, profile } = useAppState();
  const { isConnected, isInitialized } = useBroker();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showBrokerGate, setShowBrokerGate] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showWelcomeToast, setShowWelcomeToast] = useState(false);
  const greetingShown = useRef(false);
  const dailyOpenSent = useRef(false);

  const demoStatus = useMemo(() =>
    getDemoStatus(
      profile?.demo_start_at ?? null,
      profile?.demo_expires_at ?? null
    ),
    [profile?.demo_start_at, profile?.demo_expires_at]
  );

  const [chatMessages, setChatMessages] = useState<
    { role: 'user' | 'ai'; content: string }[]
  >([]);

  const router = useRouter();

  // Derive auth state from Supabase (new auth system)
  const isDataLoaded = state !== 'loading';
  const isAuthenticated = state === 'authenticated';

  // Map Supabase user + profile to the User shape AppShell expects
  const effectiveUser = useMemo<User | null>(() => {
    if (!supabaseUser) return null;
    const displayName =
      (profile?.first_name && profile?.last_name
        ? `${profile.first_name} ${profile.last_name}`
        : profile?.first_name) ||
      supabaseUser.user_metadata?.full_name ||
      supabaseUser.user_metadata?.name ||
      supabaseUser.email?.split('@')[0] ||
      '';
    const name = profile?.first_name || displayName;
    return {
      id: supabaseUser.id,
      email: supabaseUser.email || '',
      displayName,
      name,
      investorStyle: (profile?.investor_style as User['investorStyle']) || 'buffett',
      investorStyleOnboarded: !!profile?.investor_style_onboarded,
      riskTolerance: (profile?.risk_tolerance as User['riskTolerance']) || 'Moderate',
      createdAt: supabaseUser.created_at || '',
    };
  }, [supabaseUser, profile]);

  // ── Greeting modal after login ──
  useEffect(() => {
    if (!effectiveUser || !isDataLoaded) return;
    if (showOnboarding || showBrokerGate) return;
    if (!isAuthenticated) return;

    const fromLogin = sessionStorage.getItem('show_greeting');
    if (fromLogin === 'true') {
      sessionStorage.removeItem('show_greeting');
      greetingShown.current = true;
      setShowWelcomeToast(true);
      setTimeout(() => setShowWelcomeToast(false), 3000);
      setTimeout(() => setShowGreeting(true), 300);
    }
  }, [effectiveUser, isDataLoaded, showOnboarding, showBrokerGate, isAuthenticated]);

  // ── Daily streak sync ──
  useEffect(() => {
    if (!effectiveUser?.id || !isAuthenticated || dailyOpenSent.current) return;
    dailyOpenSent.current = true;
    onDailyOpen(effectiveUser.id).catch(() => {});
  }, [effectiveUser?.id, isAuthenticated]);

  // ── Cross-component navigation ──
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab && ['portfolio', 'invest', 'ai', 'watchlist', 'settings'].includes(detail.tab)) {
        setTab(detail.tab);
        if (detail.section) {
          setTimeout(() => {
            document.getElementById(detail.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        }
        if (detail.scrollTo === 'baskets') {
          setTimeout(() => {
            document.getElementById('baskets-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 300);
        }
        if (detail.subTab) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('vantage-set-subtab', { detail: { subTab: detail.subTab } }));
          }, 200);
        }
      }
    };
    window.addEventListener('vantage-navigate', handler);
    return () => window.removeEventListener('vantage-navigate', handler);
  }, [setTab]);

  // ── Auto-execute pending orders ──
  const { executePendingOrders } = useLivePortfolio();
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') executePendingOrders();
    };
    const handleFocus = () => executePendingOrders();
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [executePendingOrders]);

  // ── Desktop width ──
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Style onboarding check ──
  useEffect(() => {
    if (!effectiveUser || !isDataLoaded) return;
    if (effectiveUser.investorStyleOnboarded) {
      setShowOnboarding(false);
      return;
    }
    setShowOnboarding(true);
  }, [effectiveUser, isDataLoaded]);

  // ── Broker gate ──
  useEffect(() => {
    if (!effectiveUser || !isDataLoaded || showOnboarding || !isAuthenticated) return;
    if (!isInitialized) return;
    if (!isConnected && !brokerGateDismissedThisSession) {
      setShowBrokerGate(true);
    }
  }, [effectiveUser, isDataLoaded, showOnboarding, isAuthenticated, isInitialized, isConnected]);

  // ── Pending actions ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pendingActionRaw = params.get('pending_action');
    if (pendingActionRaw) {
      try {
        const action = JSON.parse(decodeURIComponent(pendingActionRaw));
        sessionStorage.setItem('vantage_pending_action', JSON.stringify(action));
        window.history.replaceState({}, '', '/');
        if (action.type === 'trade') setTab('invest');
        else if (action.type === 'basket') setTab('portfolio');
        else if (action.type === 'chat') setTab('ai');
      } catch {}
    }
  }, [setTab]);

  // ── Render guards ─────────────────────────────────────

  if (!isDataLoaded || !effectiveUser) return null;

  if (!isInitialized) return null;

  if (showOnboarding) {
    return <InvestorStyleOnboarding />;
  }

  if (showBrokerGate && isAuthenticated) {
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

      <Header />
      {TABS_WITH_MARKETBAR.has(activeTab) && <MarketBar />}
      <WatchlistBar />
      <PlayerStatusBar />
      {demoStatus.showWarning && (
        <DemoWarningBanner daysRemaining={demoStatus.daysRemaining} />
      )}
      <div className="content-area" style={activeTab === 'ai' ? { overflow: 'hidden', paddingBottom: '64px', display: 'flex', flexDirection: 'column' } : undefined}>
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
    <div className="app-shell bg-app">
      {isDesktop && <DesktopSidebar />}
      {isDesktop ? <div className="main-panel">{mainContent}</div> : mainContent}

      {showWelcomeToast && (() => {
        const initial = ((effectiveUser?.name || effectiveUser?.email || 'M')[0]?.toUpperCase() || 'M') + '.';
        return (
          <div style={{
            position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)', zIndex: 99997,
            background: '#1a2235', border: '1px solid rgba(34,211,238,0.3)', borderRadius: '12px',
            padding: '12px 20px', display: 'flex', alignItems: 'center', gap: '10px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.4)', animation: 'welcomeSlideDown 0.4s ease-out',
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

      {showGreeting && <GreetingModal onComplete={() => setShowGreeting(false)} />}
    </div>
  );
}

// ── Public export: wraps AppShell with providers ─────────────

export default function MainApp() {
  return (
    <AppErrorBoundary>
      <BrokerProvider>
        <PortfolioProvider>
          <AppShell />
        </PortfolioProvider>
      </BrokerProvider>
    </AppErrorBoundary>
  );
}
