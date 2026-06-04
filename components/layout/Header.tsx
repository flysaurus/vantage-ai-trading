'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Bell, Settings, X } from 'lucide-react';
import { useMarketStore, useTabStore } from '@/store';

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

export function Header() {
  const { isMarketOpen } = useMarketStore();
  const { setTab } = useTabStore();
  const router = useRouter();

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread');
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(data.count || 0);
      }
    } catch { /* ignore */ }
  }, []);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/list');
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
      }
    } catch { /* ignore */ }
  }, []);

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setUnreadCount(0);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch { /* ignore */ }
  };

  // Poll unread count every 60s
  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 60000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

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
    <div className="app-header" ref={dropdownRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="logo">Vantage</div>
        <div className={`market-status ${!isMarketOpen ? 'closed' : ''}`}>
          {isMarketOpen ? 'OPEN' : 'CLOSED'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="icon-btn"><Search size={16} /></button>
        <button
          className="icon-btn"
          onClick={handleBellClick}
          style={{ position: 'relative' }}
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', top: -2, right: -2,
              minWidth: 16, height: 16, padding: '0 4px',
              background: '#ef4444', borderRadius: 10,
              fontSize: 10, fontWeight: 700, color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid #0f172a',
            }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <button className="icon-btn" onClick={() => setTab('settings')}>
          <Settings size={16} />
        </button>
      </div>

      {/* Notification Dropdown */}
      {showDropdown && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 8,
          width: 320, maxHeight: 400, overflowY: 'auto',
          background: '#1e293b', border: '1px solid #334155',
          borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          zIndex: 1000,
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 14px', borderBottom: '1px solid #334155',
            position: 'sticky', top: 0, background: '#1e293b',
            borderTopLeftRadius: 12, borderTopRightRadius: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Notifications</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  style={{
                    padding: '4px 10px', fontSize: 10, fontWeight: 600,
                    background: 'none', border: '1px solid #334155',
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
                  color: '#64748b', cursor: 'pointer',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Items */}
          {notifications.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
              No notifications yet
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid #1e293b',
                  borderLeft: n.is_read ? '3px solid transparent' : '3px solid #06b6d4',
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
                  <span style={{ fontSize: 10, color: '#64748b' }}>
                    {timeAgo(n.created_at)}
                  </span>
                  {n.action_url && (
                    <span style={{ fontSize: 10, color: '#06b6d4', fontWeight: 600 }}>
                      Take Action →
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <style jsx>{`
        .icon-btn {
          width: 32px; height: 32px;
          background: #1e293b; border: none;
          border-radius: 8px; color: #cbd5e1;
          cursor: pointer; display: flex;
          align-items: center; justify-content: center;
        }
      `}</style>
    </div>
  );
}
