'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/layout/Header';
import { BottomNav } from '@/components/layout/BottomNav';
import { MarketBar } from '@/components/layout/MarketBar';
import { WatchlistBar } from '@/components/layout/WatchlistBar';
import { AITab } from '@/components/ai/AITab';
import { TradeTab } from '@/components/trade/TradeTab';
import { PortfolioTab } from '@/components/portfolio/PortfolioTab';
import { OrdersTab } from '@/components/orders/OrdersTab';
import { SettingsTab } from '@/components/settings/SettingsTab';
import { BrokerProvider } from '@/components/providers/BrokerProvider';
import { AuthProvider, useAuth } from '@/components/providers/AuthProvider';
import { InvestorStyleOnboarding } from '@/components/onboarding/InvestorStyleOnboarding';
import { getUser, storeUser } from '@/lib/auth';
import { useTabStore } from '@/store';
import type { TabId } from '@/store';

const TAB_COMPONENTS: Record<TabId, React.FC> = {
  ai: AITab,
  trade: TradeTab,
  portfolio: PortfolioTab,
  orders: OrdersTab,
  settings: SettingsTab,
};

function AppShell() {
  const { activeTab } = useTabStore();
  const { user, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [redirecting, setRedirecting] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !redirecting) {
      setRedirecting(true);
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, redirecting, router]);

  // Show onboarding for authenticated users who haven't set their style
  useEffect(() => {
    if (!user) return;
    // Dual check: Supabase user object + localStorage fallback
    const localStorageOnboarded = typeof window !== 'undefined'
      ? localStorage.getItem('vantage:onboarded') === 'true'
      : false;
    if (!user.investorStyleOnboarded && !localStorageOnboarded) {
      setShowOnboarding(true);
    }
  }, [user]);

  // During initial load, show nothing — avoid SSR spinner mismatch
  if (isLoading || (!isAuthenticated && !redirecting)) {
    return null;
  }

  // Router is pushing to /login
  if (!isAuthenticated) {
    return null;
  }

  return (
    <BrokerProvider brokerId="alpaca" config={{ environment: 'paper' }}>
      <div className="app-shell">
        <Header />
        <MarketBar />
        <WatchlistBar />
        <div className="content-area">
          {React.createElement(TAB_COMPONENTS[activeTab])}
        </div>
        <BottomNav />
      </div>

      {/* Onboarding Overlay */}
      {showOnboarding && user && (
        <InvestorStyleOnboarding
          userId={user.id}
          onComplete={(style) => {
            // Persist immediately — localStorage is synchronous, survives everything
            if (typeof window !== 'undefined') {
              localStorage.setItem('vantage:onboarded', 'true');
              localStorage.setItem('vantage:investorStyle', style);
            }
            // Also update sessionStorage cache (optional, nice-to-have)
            try {
              const cached = getUser();
              if (cached) {
                storeUser({ ...cached, investorStyleOnboarded: true, investorStyle: style });
              }
            } catch { /* ignore */ }
            setShowOnboarding(false);
            // Small delay to ensure localStorage flush before reload
            setTimeout(() => window.location.reload(), 100);
          }}
        />
      )}
    </BrokerProvider>
  );
}

export default function Home() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
