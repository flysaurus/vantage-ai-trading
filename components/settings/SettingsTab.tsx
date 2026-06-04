'use client';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useBroker } from '@/components/providers/BrokerProvider';
import { usePortfolio } from '@/hooks/usePortfolio';
import { getWatchlists } from '@/lib/supabase/watchlists';
import { getAlerts } from '@/lib/supabase/alerts';
import { 
  Star, Bell, Newspaper, CalendarDays, Search, 
  History, Target, CreditCard, Plug, Settings2, HelpCircle,
  ChevronRight, Building2, CircleDot, TrendingUp,
  AlertTriangle, Shield
} from 'lucide-react';
import type { BrokerId } from '@/types/broker';

interface SettingsItemProps {
  icon: typeof Star;
  title: string;
  subtitle: string;
  badge?: number | string;
  badgeColor?: string;
  onClick?: () => void;
}

function capitalizeStyle(style: string): string {
  return style.charAt(0).toUpperCase() + style.slice(1);
}

function SettingsItem({ icon: Icon, title, subtitle, badge, badgeColor, onClick }: SettingsItemProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: 12,
        cursor: 'pointer', borderBottom: '1px solid #0f172a',
      }}
    >
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'rgba(6,182,212,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={16} style={{ color: '#06b6d4' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
      </div>
      {badge !== undefined && badge !== '' ? (
        <span style={{ background: badgeColor || '#ef4444', color: 'white', fontSize: 9, padding: '2px 6px', borderRadius: 8, fontWeight: 700 }}>
          {badge}
        </span>
      ) : null}
      <ChevronRight size={14} style={{ color: '#64748b' }} />
    </div>
  );
}

const BROKER_EMOJIS: Record<string, string> = {
  alpaca: '🦙',
  tastytrade: '🍝',
  ibkr: '🏦',
  schwab: '📊',
  robinhood: '🌮',
};

const BROKER_NAMES: Record<string, string> = {
  alpaca: 'Alpaca Markets',
  tastytrade: 'tastytrade',
  ibkr: 'Interactive Brokers',
  schwab: 'Charles Schwab',
  robinhood: 'Robinhood',
};

export function SettingsTab() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { account } = usePortfolio();
  const { isConnected, brokerId, accountPreview, environment } = useBroker();
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [brokerExpanded, setBrokerExpanded] = useState(false);

  // Toast notification for items not yet built
  const [toast, setToast] = useState<string | null>(null);

  // Real counts from DB
  const [watchlistCount, setWatchlistCount] = useState(0);
  const [watchlistSymbolCount, setWatchlistSymbolCount] = useState(0);
  const [activeAlertCount, setActiveAlertCount] = useState(0);
  const [triggeredAlertCount, setTriggeredAlertCount] = useState(0);
  const [riskTolerance, setRiskTolerance] = useState<string>('moderate');

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handleRiskChange = useCallback(async (value: string) => {
    setRiskTolerance(value);
    await fetch('/api/user/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk_tolerance: value })
    });
  }, []);

  // Load real watchlist and alert counts
  useEffect(() => {
    if (!user) return;
    getWatchlists(user.id).then(wls => {
      setWatchlistCount(wls.length);
      setWatchlistSymbolCount(wls.reduce((sum, w) => sum + (w.stocks?.length || 0), 0));
    }).catch(() => {});
    getAlerts(user.id, true).then(alerts => {
      setActiveAlertCount(alerts.length);
      setTriggeredAlertCount(alerts.filter(a => a.triggeredAt).length);
    }).catch(() => {});
  }, [user]);

  const holdingsCount = account?.positions?.length || 0;

  const handleDisconnect = async () => {
    if (!brokerId || !isConnected) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/broker/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brokerId }),
      });
      if (res.ok) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('vantage:brokerConnected');
          localStorage.removeItem('vantage:brokerId');
        }
        setShowDisconnectConfirm(false);
        // Reload so BrokerProvider re-checks status
        window.location.reload();
      } else {
        showToast('Failed to disconnect. Please try again.');
      }
    } catch {
      showToast('Network error. Please try again.');
    }
    setDisconnecting(false);
  };

  const handleChangeBroker = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('vantage:onboarded');
      localStorage.removeItem('vantage:brokerSkipped');
      localStorage.removeItem('vantage:brokerConnected');
      localStorage.removeItem('vantage:brokerId');
      window.location.reload();
    }
  };

  const brokerSubtitle = isConnected && brokerId
    ? `${BROKER_EMOJIS[brokerId] || ''} ${BROKER_NAMES[brokerId] || brokerId} · ${environment || 'Connected'}`
    : 'Not connected';

  return (
    <div style={{ padding: '12px 16px 120px' }}>
      {/* Portfolio & Research */}
      <div className="section" style={{ marginTop: 0 }}>
        <SettingsItem
          icon={TrendingUp}
          title="Investor Style"
          subtitle={user?.investorStyle ? `${capitalizeStyle(user.investorStyle)} · Tap to change` : 'Tap to set your style'}
          badge={user?.investorStyle ? capitalizeStyle(user.investorStyle) : undefined}
          badgeColor="#06b6d4"
          onClick={() => router.push('/investor-style')}
        />
      </div>

      {/* Risk Tolerance */}
      <div className="section" style={{ marginTop: 12 }}>
        <div style={{ padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9', marginBottom: 4 }}>
            Risk Tolerance
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
            Adjusts stock recommendations within your {user?.investorStyle ? capitalizeStyle(user.investorStyle) : 'Value'}-Style approach
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { value: 'conservative', label: 'Conservative', emoji: '🛡️', desc: 'Lower volatility, established names' },
              { value: 'moderate', label: 'Moderate', emoji: '⚖️', desc: 'Balanced risk and reward' },
              { value: 'aggressive', label: 'Aggressive', emoji: '🚀', desc: 'Higher growth, higher risk' }
            ].map(option => (
              <button
                key={option.value}
                onClick={() => handleRiskChange(option.value)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: 12,
                  borderRadius: 12,
                  border: `1px solid ${riskTolerance === option.value ? '#06b6d4' : '#334155'}`,
                  background: riskTolerance === option.value ? 'rgba(6,182,212,0.1)' : '#0f172a',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 24 }}>{option.emoji}</span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: riskTolerance === option.value ? '#22d3ee' : '#cbd5e1',
                  marginTop: 4,
                }}>
                  {option.label}
                </span>
              </button>
            ))}
          </div>

          <div style={{
            textAlign: 'center',
            fontSize: 10,
            color: '#64748b',
            marginTop: 12,
          }}>
            {[
              { value: 'conservative', desc: 'Lower volatility, established names' },
              { value: 'moderate', desc: 'Balanced risk and reward' },
              { value: 'aggressive', desc: 'Higher growth, higher risk' }
            ].find(o => o.value === riskTolerance)?.desc}
          </div>
        </div>
      </div>

      {/* Portfolio & Research */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem
          icon={Star} title="Watchlists"
          subtitle={`${watchlistCount} list${watchlistCount !== 1 ? 's' : ''} · ${watchlistSymbolCount} symbol${watchlistSymbolCount !== 1 ? 's' : ''}`}
          onClick={() => router.push('/watchlists')}
        />
        <SettingsItem
          icon={Bell} title="Price Alerts"
          subtitle={activeAlertCount === 0 ? 'No active alerts' : `${activeAlertCount} active alert${activeAlertCount !== 1 ? 's' : ''}`}
          badge={triggeredAlertCount > 0 ? triggeredAlertCount : undefined}
          badgeColor="#ef4444"
          onClick={() => router.push('/price-alerts')}
        />
        <SettingsItem
          icon={Newspaper} title="News Feed" subtitle="AI-curated for your portfolio"
          onClick={() => router.push('/news-feed')}
        />
        <SettingsItem
          icon={CalendarDays} title="Earnings Calendar"
          subtitle={holdingsCount > 0 ? `${holdingsCount} holding${holdingsCount !== 1 ? 's' : ''} tracked` : 'Track holdings earnings'}
          onClick={() => router.push('/earnings-calendar')}
        />
        <SettingsItem
          icon={Search} title="Stock Screener" subtitle="Find new opportunities"
          onClick={() => router.push('/stock-screener')}
        />
      </div>

      {/* Account & History */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem
          icon={History} title="Trade History" subtitle="All time activity & taxes"
          onClick={() => router.push('/trade-history')}
        />
        <SettingsItem
          icon={Target} title="Goals & Targets" subtitle="Track financial milestones"
          onClick={() => router.push('/goals')}
        />
      </div>

      {/* Broker Connection */}
      <div className="section" style={{ marginTop: 12 }}>
        <div
          onClick={() => setBrokerExpanded(!brokerExpanded)}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: 12,
            cursor: 'pointer', borderBottom: brokerExpanded ? '1px solid #0f172a' : 'none',
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(6,182,212,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Plug size={16} style={{ color: '#06b6d4' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Connected Brokers</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
              {brokerSubtitle}
            </div>
          </div>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: isConnected ? '#22c55e' : '#64748b',
            boxShadow: isConnected ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
            flexShrink: 0,
          }} />
          <ChevronRight
            size={14}
            style={{
              color: '#64748b',
              transform: brokerExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }}
          />
        </div>

        {/* Expandable Details */}
        {brokerExpanded && (
          <div style={{ padding: '0 12px 12px' }}>
            {/* Account Preview (shown when connected) */}
            {isConnected && accountPreview ? (
              <div style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: '#0f172a',
                border: '1px solid #1e293b',
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 8,
                marginBottom: 10,
              }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Equity</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#4ade80' }}>
                    ${accountPreview.equity?.toLocaleString() ?? '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Buying Power</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>
                    ${accountPreview.buyingPower?.toLocaleString() ?? '—'}
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: '#64748b', textTransform: 'uppercase', marginBottom: 2 }}>Status</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: accountPreview.status === 'active' ? '#4ade80' : '#fbbf24' }}>
                    {accountPreview.status ?? '—'}
                  </div>
                </div>
              </div>
            ) : isConnected ? null : (
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px', lineHeight: 1.5 }}>
                Connect your brokerage account to see your portfolio, positions, and start trading.
              </p>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleChangeBroker}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {isConnected ? 'Change Broker' : 'Connect Broker'}
              </button>
              {isConnected && (
                <button
                  onClick={() => setShowDisconnectConfirm(true)}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    borderRadius: 8,
                    border: '1px solid rgba(239,68,68,0.3)',
                    background: 'rgba(239,68,68,0.08)',
                    color: '#f87171',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>

            {/* Security Link */}
            <div style={{ marginTop: 10, fontSize: 10 }}>
              <a
                href="/security"
                style={{
                  color: '#06b6d4',
                  textDecoration: 'none',
                  fontWeight: 500,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={12} />
                Learn about how we secure your data →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* System */}
      <div className="section" style={{ marginTop: 12 }}>
        <SettingsItem
          icon={CreditCard} title="Account & Funding" subtitle="Deposits, withdrawals, tax docs"
          onClick={() => router.push('/account')}
        />
        <SettingsItem
          icon={Settings2} title="Preferences" subtitle="Appearance, notifications & security"
          onClick={() => router.push('/preferences')}
        />
        <SettingsItem
          icon={HelpCircle} title="Help & Support" subtitle="Documentation & contact"
          onClick={() => router.push('/help')}
        />
      </div>

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: 60, left: '50%', transform: 'translateX(-50%)',
          zIndex: 200, padding: '10px 20px', borderRadius: 20,
          background: '#1e293b', border: '1px solid #06b6d4', color: '#e2e8f0',
          fontSize: 13, fontWeight: 500, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap',
        }}>
          {toast}
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <>
          <div
            onClick={() => setShowDisconnectConfirm(false)}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.6)', zIndex: 100,
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#1e293b', border: '1px solid #334155',
            borderRadius: 16, zIndex: 101,
            width: '92%', maxWidth: 400,
            padding: 24,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <AlertTriangle size={24} style={{ color: '#fbbf24' }} />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Disconnect Broker?</h3>
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5, margin: '0 0 20px' }}>
              Are you sure? This will permanently remove your broker connection.
              All portfolio data will stop updating.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowDisconnectConfirm(false)}
                disabled={disconnecting}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: '1px solid #334155',
                  background: 'transparent',
                  color: '#94a3b8',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                style={{
                  flex: 1,
                  padding: '10px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: 'rgba(239,68,68,0.9)',
                  color: 'white',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: disconnecting ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                  opacity: disconnecting ? 0.7 : 1,
                }}
              >
                {disconnecting ? 'Disconnecting...' : 'Yes, Disconnect'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Sign Out */}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={async () => {
            await signOut();
            window.location.href = '/login';
          }}
          style={{
            width: '100%', padding: '12px',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 10, color: '#f87171', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          Sign Out
        </button>
      </div>

      {/* Vantage Version */}
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, background: 'linear-gradient(135deg, #06b6d4, #0d9488)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          Vantage v0.1.0
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
          AI-First · Mobile-First · Built with ❤️
        </div>
      </div>

      <style jsx>{`
        .section {
          background: #1e293b;
          border: 1px solid #334155;
          border-radius: 12px;
          overflow: hidden;
        }
        .section > div:last-child { border-bottom: none; }
      `}</style>
    </div>
  );
}
