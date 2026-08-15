'use client';

import { apiGet, apiPost } from '@/lib/api-client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bell, Settings, X } from 'lucide-react';
import { VantageOrb } from '@/components/brand/VantageOrb';
import { useTabStore } from '@/store';
import { getMarketStatus } from '@/lib/market-hours';

interface Notification {
  id: string;
  type: string;
  title: string;
  message?: string;
  action_url?: string;
  is_read: boolean;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getStatusPillClass(label: string): string {
  if (label === 'OPEN') return 'header-pill header-pill-open';
  if (label === 'PRE-MARKET') return 'header-pill header-pill-premarket';
  if (label === 'AFTER HOURS') return 'header-pill header-pill-afterhours';
  if (label === 'MARKET HOLIDAY') return 'header-pill header-pill-holiday';
  return 'header-pill header-pill-closed';
}

function shortenLabel(label: string): string {
  if (label === 'MARKET HOLIDAY') return 'HOLIDAY';
  if (label === 'PRE-MARKET') return 'PRE-MKT';
  if (label === 'AFTER HOURS') return 'AFTER HRS';
  return label;
}

export function Header() {
  const { setTab } = useTabStore();
  const router = useRouter();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [orderNotifsEnabled, setOrderNotifsEnabled] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await await apiGet('/api/notifications/unread');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchList = useCallback(async () => {
    try {
      const res = await await apiGet('/api/notifications/list');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch { /* ignore */ }
  }, []);

  const markAllRead = async () => {
    try {
      await apiPost('/api/notifications/mark-read', { all: true });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch { /* ignore */ }
  };

  const fetchNotifPref = useCallback(async () => {
    try {
      const res = await apiGet('/api/notifications/preferences');
      if (res.ok) {
        const data = await res.json();
        setOrderNotifsEnabled(data.order_notifications_enabled !== false);
      }
    } catch { /* ignore */ }
  }, []);

  const toggleOrderNotifs = async () => {
    const next = !orderNotifsEnabled;
    setOrderNotifsEnabled(next); // optimistic
    try {
      await apiPost('/api/notifications/preferences', { order_notifications_enabled: next });
    } catch { /* ignore */ }
  };

  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  useEffect(() => {
    fetchUnread();
    fetchNotifPref();
    const interval = setInterval(() => {
      fetchUnread();
      setMarketStatus(getMarketStatus());
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchUnread, fetchNotifPref]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  const handleBellClick = () => {
    setShowDropdown(prev => !prev);
    if (!showDropdown) fetchList();
  };

  return (
    <div className="app-header-v2" ref={dropdownRef} style={{ position: 'relative' }}>
      {/* ── Left: Orb + Wordmark ── */}
      <div className="header-left">
        <div style={{ width: 32, height: 32, flexShrink: 0 }}>
          <VantageOrb size={32} animate showEntrance={false} />
        </div>
        <span className="header-wordmark">VANTAGE</span>
      </div>

      {/* ── Center: Market Status Pill ── */}
      <span className={getStatusPillClass(marketStatus.label)}>
        ● {shortenLabel(marketStatus.label)}
      </span>

      {/* ── Right: Icons ── */}
      <div className="header-icons">
        <button className="header-icon-btn" aria-label="Search">
          <Search size={22} />
        </button>
        <button
          className="header-icon-btn"
          onClick={handleBellClick}
          style={{ position: 'relative' }}
          aria-label="Notifications"
        >
          <Bell size={22} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              minWidth: 16, height: 16, padding: '0 4px',
              background: '#ef4444', borderRadius: 10,
              fontSize: 10, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #0a0f1e',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button
          className="header-icon-btn"
          onClick={() => setTab('settings')}
          aria-label="Settings"
        >
          <Settings size={22} />
        </button>
      </div>

      {/* ── Notification Dropdown ── */}
      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 320, maxHeight: 400, overflowY: 'auto',
          background: '#131929', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          zIndex: 1000, backdropFilter: 'blur(16px)',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.06)',
            position: 'sticky', top: 0, background: '#131929',
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Notifications</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  style={{
                    padding: '4px 10px', fontSize: 10, fontWeight: 600,
                    background: 'none', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 6, color: '#94a3b8', cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Mark all read
                </button>
              )}
              <button
                onClick={() => setShowDropdown(false)}
                style={{
                  width: 24, height: 24, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', background: 'none', border: 'none',
                  color: '#e2e8f0', cursor: 'pointer',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Items */}
          {notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#e2e8f0' }}>
              No notifications yet
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  borderLeft: n.is_read ? '3px solid transparent' : '3px solid #22d3ee',
                  cursor: n.action_url ? 'pointer' : 'default',
                }}
                onClick={() => {
                  if (n.action_url) {
                    setShowDropdown(false);
                    router.push(n.action_url);
                  }
                }}
              >
                <div style={{ fontSize: 12, fontWeight: n.is_read ? 500 : 700, color: '#f1f5f9', marginBottom: 2 }}>
                  {n.title}
                </div>
                {n.message && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    {n.message}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: '#e2e8f0' }}>
                    {timeAgo(n.created_at)}
                  </span>
                  {n.action_url && (
                    <span style={{ fontSize: 10, color: '#22d3ee', fontWeight: 600 }}>
                      Take Action →
                    </span>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Preference toggle */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)',
            position: 'sticky', bottom: 0, background: '#131929',
            borderBottomLeftRadius: 16, borderBottomRightRadius: 16,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>
              Order alerts
            </span>
            <button
              onClick={toggleOrderNotifs}
              style={{
                width: 34, height: 18, borderRadius: 9, border: 'none',
                cursor: 'pointer', position: 'relative',
                background: orderNotifsEnabled ? '#22d3ee' : '#334155',
                transition: 'background 0.2s',
              }}
              aria-label={orderNotifsEnabled ? 'Mute order alerts' : 'Unmute order alerts'}
            >
              <span style={{
                position: 'absolute', top: 2,
                left: orderNotifsEnabled ? 18 : 2,
                width: 14, height: 14, borderRadius: 7,
                background: '#fff', transition: 'left 0.2s',
              }} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
