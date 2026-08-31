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
import { useOrders } from '@/hooks/useOrders';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { InvestorStyleBadge } from '@/components/layout/InvestorStyleBadge';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import WatchlistTab from '@/components/ai/WatchlistTab';
import { BrokerProvider, useBroker } from '@/components/providers/BrokerProvider';
import { AccountProvider, useAccounts } from '@/context/AccountContext';
import { AccountSwitcher } from '@/components/accounts/AccountSwitcher';
import AccountSelectScreen from '@/components/accounts/AccountSelectScreen';
import { PortfolioProvider, useLivePortfolio } from '@/context/PortfolioContext';
import { useAppState } from '@/lib/app-state';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';
import GreetingModal from '@/components/GreetingModal';

import type { User } from '@/types';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';

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
  const [isDesktop, setIsDesktop] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [showWelcomeToast, setShowWelcomeToast] = useState(false);
  const greetingShown = useRef(false);

  const [chatMessages, setChatMessages] = useState<
    { role: 'user' | 'ai'; content: string }[]
  >([]);

  const router = useRouter();

  // ── Account Select Screen ─────────────────────────────────
  const [showAccountSelect, setShowAccountSelect] = useState(false);
  const { setActiveAccount, activeAccountId } = useAccounts();

  // ── Chat state is ACCOUNT-scoped ──
  // `chatMessages` lives here (parent) but AITab (which hydrates/renders it)
  // is only mounted when the AI tab is active. If the account is switched while
  // the AI tab is NOT mounted, AITab's own reset effect never runs, so the
  // previous account's messages would linger in `chatMessages` and leak into the
  // next account's view. Clear it here — at the point the account actually
  // changes — so no account's chat ever bleeds into another.
  const prevChatAccountRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevChatAccountRef.current === null) {
      prevChatAccountRef.current = activeAccountId;
      return;
    }
    if (prevChatAccountRef.current !== activeAccountId) {
      prevChatAccountRef.current = activeAccountId;
      setChatMessages([]);
    }
  }, [activeAccountId, setChatMessages]);

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
    if (showOnboarding) return;
    if (!isAuthenticated) return;

    const fromLogin = sessionStorage.getItem('show_greeting');
    if (fromLogin === 'true') {
      sessionStorage.removeItem('show_greeting');
      greetingShown.current = true;
      setShowWelcomeToast(true);
      setTimeout(() => setShowWelcomeToast(false), 3000);
      setTimeout(() => setShowGreeting(true), 300);
    }
  }, [effectiveUser, isDataLoaded, showOnboarding, isAuthenticated]);

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
  // Mount useOrders at app level so broker orders populate the Zustand store
  // regardless of which tab the user visits first (TradeTab reads from the store).
  useOrders();
  useEffect(() => {
    const triggerExec = () => {
      executePendingOrders();
      // Server-side fallback (idempotent, best-effort)
      fetch('/api/cron/trigger-execution').catch(() => {});
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerExec();
    };
    const handleFocus = () => triggerExec();
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

  // ── Tab from query param (e.g. ?tab=settings from price-alerts back button) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam && ['portfolio', 'invest', 'ai', 'watchlist', 'settings'].includes(tabParam)) {
      setTab(tabParam as TabId);
      window.history.replaceState({}, '', '/');
    }
  }, [setTab]);

  // ── Account Select screen — first login OR Settings entry ──
  useEffect(() => {
    // Settings entry: show regardless of skip preference
    if (window.location.search.includes('account-select=true')) {
      setShowAccountSelect(true);
      window.history.replaceState({}, '', '/');
      return;
    }
    // One-time suppression (e.g. DCA create navigates back to '/') — consumed
    // exactly once so it never disables account selection on future logins.
    if (typeof window !== 'undefined' && sessionStorage.getItem('vantage:skipAccountSelectOnce')) {
      sessionStorage.removeItem('vantage:skipAccountSelectOnce');
      return;
    }
    // First login: show once unless user previously opted out
    if (typeof window !== 'undefined' && !localStorage.getItem('vantage:skipAccountSelect:v2')) {
      setShowAccountSelect(true);
    }
  }, []);

  // ── Account Select handlers ────────────────────────────
  const handleAccountSelect = useCallback((accountId: string) => {
    setActiveAccount(accountId);
    setShowAccountSelect(false);
  }, [setActiveAccount]);

  const handleAddBroker = useCallback(() => {
    router.push('/broker-setup');
  }, [router]);

  const handleAccountSelectDismiss = useCallback(() => {
    setShowAccountSelect(false);
  }, []);

  // ── Render guards ─────────────────────────────────────

  if (!isDataLoaded || !effectiveUser) return null;

  if (!isInitialized) return null;

  if (showOnboarding) {
    return <InvestorStyleOnboarding />;
  }

  const mainContent = (
    <>

      <Header />
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5">
        <AccountSwitcher />
        <InvestorStyleBadge />
        {/* Read-only trading warning */}
        <ActiveAccountWarning />
      </div>
      {TABS_WITH_MARKETBAR.has(activeTab) && <MarketBar />}
      <WatchlistBar />
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

      {/* Account Select overlay — full-screen, shown on first login or from Settings */}
      {showAccountSelect && (
        <AccountSelectScreen
          onSelect={handleAccountSelect}
          onAddBroker={handleAddBroker}
          onDismiss={handleAccountSelectDismiss}
        />
      )}
    </div>
  );
}

// ── Public export: wraps AppShell with providers ─────────────

export default function MainApp() {
  return (
    <AppErrorBoundary>
      <AccountProvider>
        <BrokerProvider>
          <PortfolioProvider>
            <AppShell />
          </PortfolioProvider>
        </BrokerProvider>
      </AccountProvider>
    </AppErrorBoundary>
  );
}

// ── Read-only account warning ──
// Shown in the header when a read-only broker is the active account.
function ActiveAccountWarning() {
  const { activeAccount } = useAccounts();

  if (!activeAccount || activeAccount.isDemo || activeAccount.tradingEnabled) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-amber-400/80 ml-auto">
      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <span>
        Trading not available — <strong>{activeAccount.broker}</strong> is read-only
      </span>
    </div>
  );
}
