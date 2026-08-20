'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── Types ──────────────────────────────────────────────────────

interface AggregatedUser {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  investor_style: string | null;
  investor_style_onboarded: boolean | null;
  tier: string | null;
  is_admin: boolean | null;
  suspended: boolean | null;
  subscription_tier_key: string | null;
  subscription_tier_name: string | null;
  subscription_status: string | null;
  total_score: number | null;
  baskets_created: number | null;
  trades_executed: number | null;
  ai_sessions: number | null;
  milestones_earned: number | null;
  last_level: number | null;
  milestone_count: number | null;
  current_streak: number | null;
  longest_streak: number | null;
  total_days_active: number | null;
  monthly_chat_used: number | null;
  demo_expires_at: string | null;
  created_at: string;
  updated_at: string | null;
  deleted: boolean | null;
}

interface AuditEntry {
  id: string;
  admin_email: string;
  target_user_id: string;
  action: string;
  old_value: any;
  new_value: any;
  reason: string | null;
  created_at: string;
}

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

// ─── Helpers ────────────────────────────────────────────────────

function tierColor(tier: string | null): { bg: string; text: string } {
  switch (tier) {
    case 'gold':
      return { bg: 'rgba(234,179,8,0.15)', text: '#facc15' };
    case 'silver':
      return { bg: 'rgba(6,182,212,0.15)', text: '#22d3ee' };
    case 'demo':
    default:
      return { bg: 'rgba(139,148,158,0.15)', text: '#8b949e' };
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatNumber(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString();
}

// ─── Activity Modal Helpers ────────────────────────────────────

const sectionStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #21262d',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '0.75rem',
};

const sectionTitle: React.CSSProperties = {
  color: '#8b949e',
  fontSize: '0.6875rem',
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  marginBottom: '10px',
  paddingBottom: '6px',
  borderBottom: '1px solid #21262d',
};

const grid2Col: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px 16px',
};

const grid3Col: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: '8px 16px',
};

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ color: '#8b949e', fontSize: '0.625rem', marginBottom: '2px' }}>{label}</div>
      <div style={{
        color: highlight ? '#e6edf3' : '#c9d1d9',
        fontSize: '0.8125rem',
        fontWeight: highlight ? 600 : 400,
      }}>
        {value}
      </div>
    </div>
  );
}

function auditBadge(action: string): React.CSSProperties {
  return {
    display: 'inline-block',
    padding: '0.0625rem 0.375rem',
    borderRadius: 3,
    fontSize: '0.625rem',
    fontWeight: 600,
    background: action.includes('suspend') || action.includes('delete') ? 'rgba(218,54,51,0.15)'
      : action.includes('admin') ? 'rgba(234,179,8,0.15)'
      : action.includes('restore') ? 'rgba(35,134,54,0.15)'
      : 'rgba(88,166,255,0.15)',
    color: action.includes('suspend') || action.includes('delete') ? '#f85149'
      : action.includes('admin') ? '#facc15'
      : action.includes('restore') ? '#3fb950'
      : '#58a6ff',
  };
}

// ─── Styles ─────────────────────────────────────────────────────

const styles = {
  container: {
    background: '#0d1117',
    minHeight: '100vh',
    padding: '1.5rem',
    color: '#e6edf3',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  } as React.CSSProperties,

  header: {
    fontSize: '1.25rem',
    fontWeight: 700,
    marginBottom: '1rem',
  } as React.CSSProperties,

  searchRow: {
    display: 'flex',
    gap: '0.75rem',
    marginBottom: '1rem',
    flexWrap: 'wrap' as const,
  },

  searchInput: {
    flex: '1 1 240px',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid #30363d',
    background: '#161b22',
    color: '#e6edf3',
    fontSize: '0.875rem',
    outline: 'none',
  } as React.CSSProperties,

  refreshBtn: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: '1px solid #30363d',
    background: '#161b22',
    color: '#e6edf3',
    fontSize: '0.875rem',
    cursor: 'pointer',
  } as React.CSSProperties,

  tableWrap: {
    overflowX: 'auto' as const,
    borderRadius: 8,
    border: '1px solid #30363d',
  },

  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '0.8125rem',
  } as React.CSSProperties,

  th: {
    padding: '0.5rem 0.75rem',
    textAlign: 'left' as const,
    fontWeight: 600,
    color: '#8b949e',
    borderBottom: '1px solid #30363d',
    background: '#161b22',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
  },

  td: {
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid #21262d',
    verticalAlign: 'middle' as const,
  },

  tierBadge: (tier: string | null) => {
    const c = tierColor(tier);
    return {
      display: 'inline-block',
      padding: '0.125rem 0.5rem',
      borderRadius: 10,
      background: c.bg,
      color: c.text,
      fontSize: '0.75rem',
      fontWeight: 600,
      textTransform: 'capitalize' as const,
    };
  },

  actionBtn: {
    padding: '0.25rem 0.625rem',
    borderRadius: 4,
    border: '1px solid #30363d',
    background: '#21262d',
    color: '#58a6ff',
    fontSize: '0.75rem',
    cursor: 'pointer',
  } as React.CSSProperties,

  card: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: '0.75rem',
    marginBottom: '0.5rem',
  } as React.CSSProperties,

  cardRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.25rem 0',
    fontSize: '0.8125rem',
  } as React.CSSProperties,

  cardLabel: {
    color: '#8b949e',
    fontSize: '0.6875rem',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },

  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem',
  } as React.CSSProperties,

  modal: {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    padding: '1.5rem',
    maxWidth: 420,
    width: '100%',
    color: '#e6edf3',
  } as React.CSSProperties,

  modalTitle: {
    fontSize: '1rem',
    fontWeight: 700,
    marginBottom: '1rem',
  } as React.CSSProperties,

  radioGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.5rem',
    marginBottom: '1rem',
  },

  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid #30363d',
    cursor: 'pointer',
    fontSize: '0.875rem',
  } as React.CSSProperties,

  textareaInput: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid #30363d',
    background: '#0d1117',
    color: '#e6edf3',
    fontSize: '0.875rem',
    resize: 'vertical' as const,
    minHeight: 60,
    marginBottom: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
  } as React.CSSProperties,

  modalActions: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'flex-end',
  } as React.CSSProperties,

  cancelBtn: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: '1px solid #30363d',
    background: 'transparent',
    color: '#8b949e',
    fontSize: '0.875rem',
    cursor: 'pointer',
  } as React.CSSProperties,

  confirmBtn: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: 'none',
    background: '#238636',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,

  toast: (type: 'success' | 'error') => ({
    position: 'fixed',
    bottom: '1rem',
    right: '1rem',
    padding: '0.75rem 1rem',
    borderRadius: 8,
    background: type === 'success' ? '#238636' : '#da3633',
    color: '#fff',
    fontSize: '0.875rem',
    fontWeight: 600,
    zIndex: 1100,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  } as React.CSSProperties),

  sortIndicator: {
    marginLeft: '0.25rem',
    fontSize: '0.625rem',
  } as React.CSSProperties,
};

// ─── Component ─────────────────────────────────────────────────

export function UsersManager() {
  const [users, setUsers] = useState<AggregatedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [toast, setToast] = useState<ToastState | null>(null);

  // Modal state
  const [modalUser, setModalUser] = useState<AggregatedUser | null>(null);
  const [modalType, setModalType] = useState<'tier' | 'admin' | 'suspend' | 'reset_demo' | 'activity' | 'delete' | 'reset_password' | 'reset_mfa'>('tier');
  const [selectedTier, setSelectedTier] = useState<string>('demo');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [activityEntries, setActivityEntries] = useState<AuditEntry[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // ── Fetch users ─────────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      params.set('sort', sortField);
      params.set('order', sortOrder);
      params.set('limit', '100');

      const res = await fetch(`/api/admin/users?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search, sortField, sortOrder]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── Sorting ─────────────────────────────────────────────────

  const toggleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const sortIndicator = (field: string) => {
    if (sortField !== field) return '';
    return sortOrder === 'asc' ? ' ▲' : ' ▼';
  };

  // ── Action launchers ──────────────────────────────────────

  const openModal = (user: AggregatedUser, type: 'tier' | 'admin' | 'suspend' | 'reset_demo' | 'activity' | 'delete' | 'reset_password' | 'reset_mfa') => {
    setModalUser(user);
    setModalType(type);
    setSelectedTier(user.tier || 'demo');
    setReason('');
    setSaving(false);
    setActivityEntries([]);
    if (type === 'activity') {
      loadActivity(user.id);
    }
  };

  const closeModal = () => {
    setModalUser(null);
    setReason('');
    setActivityEntries([]);
  };

  // ── Activity log fetch ───────────────────────────────────

  const loadActivity = async (userId: string) => {
    setActivityLoading(true);
    try {
      const res = await fetch(`/api/admin/users/activity?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.entries) setActivityEntries(data.entries);
    } catch {
      // silently fail
    } finally {
      setActivityLoading(false);
    }
  };

  // ── Generic action handler ────────────────────────────────

  const handleAction = async (action: string, extraBody?: Record<string, any>) => {
    if (!modalUser) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: modalUser.id,
          action,
          ...extraBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setToast({ message: data.message || 'Action completed', type: 'success' });
      closeModal();
      fetchUsers();
    } catch (e: any) {
      setToast({ message: e.message || 'Action failed', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  // ── Client-side search filter ───────────────────────────────

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.display_name && u.display_name.toLowerCase().includes(q))
    );
  }, [users, search]);

  // ── Determine if we're on mobile for card layout ────────────

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ── Render column headers ───────────────────────────────────

  const renderSortableTh = (label: string, field: string) => (
    <th style={styles.th} onClick={() => toggleSort(field)}>
      {label}
      <span style={styles.sortIndicator}>{sortIndicator(field)}</span>
    </th>
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <div style={styles.container}>
      <h1 style={styles.header}>👥 User Management</h1>

      {/* Search + Refresh */}
      <div style={styles.searchRow}>
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={styles.searchInput}
        />
        <button onClick={fetchUsers} style={styles.refreshBtn}>
          🔄 Refresh
        </button>
      </div>

      {/* Loading / Error */}
      {loading && (
        <p style={{ color: '#8b949e', textAlign: 'center', padding: '2rem' }}>
          Loading users...
        </p>
      )}
      {error && (
        <p style={{ color: '#f85149', textAlign: 'center', padding: '2rem' }}>
          Error: {error}
        </p>
      )}
      {!loading && !error && filteredUsers.length === 0 && (
        <p style={{ color: '#8b949e', textAlign: 'center', padding: '2rem' }}>
          No users found.
        </p>
      )}

      {/* Desktop Table */}
      {!loading && !error && filteredUsers.length > 0 && !isMobile && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {renderSortableTh('Email / Name', 'email')}
                {renderSortableTh('Tier', 'tier')}
                {renderSortableTh('Score', 'total_score')}
                <th style={styles.th}>Style</th>
                <th style={styles.th}>Activity</th>
                <th style={styles.th}>Usage</th>
                {renderSortableTh('Created', 'created_at')}
                <th style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const c = tierColor(u.tier);
                return (
                  <tr key={u.id}>
                    <td style={styles.td}>
                      <div style={{ fontWeight: 600 }}>
                        {u.display_name || u.email?.split('@')[0] || '—'}
                      </div>
                      {u.display_name && (
                        <div style={{ color: '#8b949e', fontSize: '0.6875rem' }}>
                          {u.email}
                        </div>
                      )}
                      {!u.display_name && u.email && (
                        <div style={{ color: '#8b949e', fontSize: '0.6875rem' }}>
                          {u.email}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <span style={styles.tierBadge(u.tier)}>
                        {u.tier || 'unknown'}
                      </span>
                      {u.deleted && (
                        <span style={{ marginLeft: '4px', background: 'rgba(218,54,51,0.15)', color: '#f85149', padding: '1px 6px', borderRadius: '4px', fontSize: '0.625rem', fontWeight: 700 }}>DELETED</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {u.total_score !== null ? (
                        <>
                          <span style={{ fontWeight: 600, color: '#e6edf3' }}>
                            {formatNumber(u.total_score)}
                          </span>
                          {u.last_level !== null && (
                            <span style={{ color: '#8b949e', marginLeft: 4 }}>
                              Lv.{u.last_level}
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: '#484f58' }}>—</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <span
                        style={{
                          color: u.investor_style ? '#e6edf3' : '#484f58',
                          fontSize: '0.75rem',
                        }}
                      >
                        {u.investor_style || '—'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontSize: '0.6875rem' }}>
                        <span style={{ color: '#8b949e' }}>Trades:</span>{' '}
                        {formatNumber(u.trades_executed)}
                      </div>
                      <div style={{ fontSize: '0.6875rem' }}>
                        <span style={{ color: '#8b949e' }}>AI:</span>{' '}
                        {formatNumber(u.ai_sessions)}
                      </div>
                      <div style={{ fontSize: '0.6875rem' }}>
                        <span style={{ color: '#8b949e' }}>Streak:</span>{' '}
                        {u.current_streak ?? '—'}
                        {u.longest_streak !== null && u.longest_streak > 0 && (
                          <span style={{ color: '#484f58' }}>
                            {' '}
                            / best {u.longest_streak}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <div style={{ fontSize: '0.6875rem' }}>
                        <span style={{ color: '#8b949e' }}>Chat:</span>{' '}
                        {formatNumber(u.monthly_chat_used)}
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#8b949e', fontSize: '0.75rem' }}>
                        {formatDate(u.created_at)}
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button onClick={() => openModal(u, 'tier')} style={styles.actionBtn} title="Edit Tier">
                          Tier
                        </button>
                        <button
                          onClick={() => openModal(u, 'admin')}
                          style={{
                            ...styles.actionBtn,
                            background: u.is_admin ? 'rgba(35,134,54,0.2)' : 'rgba(218,54,51,0.1)',
                            border: u.is_admin ? '1px solid #238636' : '1px solid #30363d',
                            color: u.is_admin ? '#3fb950' : '#f85149',
                          }}
                          title={u.is_admin ? 'Revoke admin' : 'Grant admin'}
                        >
                          {u.is_admin ? 'Admin ✓' : 'Admin ✗'}
                        </button>
                        <button
                          onClick={() => openModal(u, 'suspend')}
                          style={{
                            ...styles.actionBtn,
                            background: u.suspended ? 'rgba(218,54,51,0.2)' : 'transparent',
                            border: u.suspended ? '1px solid #da3633' : '1px solid #30363d',
                            color: u.suspended ? '#f85149' : '#8b949e',
                          }}
                          title={u.suspended ? 'Unsuspend user' : 'Suspend user'}
                        >
                          {u.suspended ? '⚫ Susp' : 'Suspend'}
                        </button>
                        {u.tier === 'demo' && (
                          <button onClick={() => openModal(u, 'reset_demo')} style={styles.actionBtn} title="Reset demo trial">
                            🔄 Demo
                          </button>
                        )}
                        <button
                          onClick={() => openModal(u, 'reset_password')}
                          style={{ ...styles.actionBtn, color: '#06b6d4' }}
                          title="Reset password"
                        >
                          🔑 PW
                        </button>
                        <button
                          onClick={() => openModal(u, 'reset_mfa')}
                          style={{ ...styles.actionBtn, color: '#f0883e' }}
                          title="Reset 2FA"
                        >
                          🔐 2FA
                        </button>
                        <button
                          onClick={() => openModal(u, 'delete')}
                          style={{
                            ...styles.actionBtn,
                            background: u.deleted ? 'rgba(35,134,54,0.15)' : 'rgba(218,54,51,0.1)',
                            border: u.deleted ? '1px solid #238636' : '1px solid #da3633',
                            color: u.deleted ? '#3fb950' : '#f85149',
                          }}
                          title={u.deleted ? 'Restore user' : 'Delete user'}
                        >
                          {u.deleted ? '♻️' : '🗑️'}
                        </button>
                        <button onClick={() => openModal(u, 'activity')} style={{ ...styles.actionBtn, color: '#8b949e' }} title="View activity">
                          📋
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mobile Card Layout */}
      {!loading && !error && filteredUsers.length > 0 && isMobile && (
        <div>
          {filteredUsers.map((u) => (
            <div key={u.id} style={styles.card}>
              {/* Header: email + tier badge */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                    {u.display_name || u.email?.split('@')[0] || '—'}
                  </div>
                  <div style={{ color: '#8b949e', fontSize: '0.6875rem' }}>
                    {u.email}
                  </div>
                </div>
                <span style={styles.tierBadge(u.tier)}>{u.tier || 'unknown'}</span>
                {u.deleted && <span style={{ marginLeft: '4px', background: 'rgba(218,54,51,0.15)', color: '#f85149', padding: '1px 6px', borderRadius: '4px', fontSize: '0.625rem', fontWeight: 700 }}>DELETED</span>}
              </div>

              {/* Fields as label-value pairs */}
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Score</span>
                <span>
                  {u.total_score !== null
                    ? `${formatNumber(u.total_score)}${u.last_level !== null ? ` · Lv.${u.last_level}` : ''}`
                    : '—'}
                </span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Style</span>
                <span>{u.investor_style || '—'}</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Trades</span>
                <span>{formatNumber(u.trades_executed)}</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>AI Sessions</span>
                <span>{formatNumber(u.ai_sessions)}</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Streak</span>
                <span>
                  {u.current_streak ?? '—'}
                  {u.longest_streak ? ` / best ${u.longest_streak}` : ''}
                </span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Chat Used</span>
                <span>{formatNumber(u.monthly_chat_used)}</span>
              </div>
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Created</span>
                <span>{formatDate(u.created_at)}</span>
              </div>
              <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                <button onClick={() => openModal(u, 'tier')} style={styles.actionBtn}>Tier</button>
                <button
                  onClick={() => openModal(u, 'admin')}
                  style={{
                    ...styles.actionBtn,
                    background: u.is_admin ? 'rgba(35,134,54,0.2)' : 'rgba(218,54,51,0.1)',
                    border: u.is_admin ? '1px solid #238636' : '1px solid #30363d',
                    color: u.is_admin ? '#3fb950' : '#f85149',
                  }}
                >
                  {u.is_admin ? 'Admin ✓' : 'Admin ✗'}
                </button>
                <button
                  onClick={() => openModal(u, 'suspend')}
                  style={{
                    ...styles.actionBtn,
                    background: u.suspended ? 'rgba(218,54,51,0.2)' : 'transparent',
                    border: u.suspended ? '1px solid #da3633' : '1px solid #30363d',
                    color: u.suspended ? '#f85149' : '#8b949e',
                  }}
                >
                  {u.suspended ? '⚫ Unsusp' : 'Suspend'}
                </button>
                {u.tier === 'demo' && (
                  <button onClick={() => openModal(u, 'reset_demo')} style={styles.actionBtn}>🔄 Demo</button>
                )}
                <button onClick={() => openModal(u, 'reset_password')} style={{ ...styles.actionBtn, color: '#06b6d4' }}>🔑 PW</button>
                <button
                  onClick={() => openModal(u, 'delete')}
                  style={{
                    ...styles.actionBtn,
                    background: u.deleted ? 'rgba(35,134,54,0.15)' : 'rgba(218,54,51,0.1)',
                    border: u.deleted ? '1px solid #238636' : '1px solid #da3633',
                    color: u.deleted ? '#3fb950' : '#f85149',
                  }}
                >
                  {u.deleted ? '♻️' : '🗑️'}
                </button>
                <button onClick={() => openModal(u, 'activity')} style={{ ...styles.actionBtn, color: '#8b949e' }}>📋</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Action Modal ── */}
      {modalUser && modalType !== 'activity' && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              {modalType === 'tier' && 'Edit Tier'}
              {modalType === 'admin' && (modalUser.is_admin ? 'Revoke Admin Access' : 'Grant Admin Access')}
              {modalType === 'suspend' && (modalUser.suspended ? 'Unsuspend User' : 'Suspend User')}
              {modalType === 'reset_demo' && 'Reset Demo Trial'}
              {modalType === 'delete' && (modalUser.deleted ? 'Restore User' : 'Delete User')}
              {modalType === 'reset_password' && 'Reset Password'}
            </h2>
            <p style={{ color: '#8b949e', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              User:{' '}
              <strong style={{ color: '#e6edf3' }}>
                {modalUser.display_name || modalUser.email}
              </strong>
            </p>

            {/* Tier: radio buttons */}
            {modalType === 'tier' && (
              <>
                <p style={{ color: '#8b949e', fontSize: '0.875rem', marginBottom: '1rem' }}>
                  Current tier:{' '}
                  <span style={styles.tierBadge(modalUser.tier)}>
                    {modalUser.tier || 'unknown'}
                  </span>
                </p>
                <div style={styles.radioGroup}>
                  {(['demo', 'silver', 'gold'] as const).map((tierOption) => (
                    <label
                      key={tierOption}
                      style={{
                        ...styles.radioLabel,
                        borderColor:
                          selectedTier === tierOption ? tierColor(tierOption).text : '#30363d',
                        background:
                          selectedTier === tierOption ? tierColor(tierOption).bg : 'transparent',
                      }}
                    >
                      <input
                        type="radio"
                        name="tier"
                        value={tierOption}
                        checked={selectedTier === tierOption}
                        onChange={(e) => setSelectedTier(e.target.value)}
                        style={{ accentColor: tierColor(tierOption).text }}
                      />
                      <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                        {tierOption}
                      </span>
                    </label>
                  ))}
                </div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    color: '#8b949e',
                    marginBottom: '0.25rem',
                    fontWeight: 600,
                  }}
                >
                  Reason (required for audit log)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why is this tier being changed?"
                  style={styles.textareaInput}
                  disabled={saving}
                />
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('tier_override', { tier: selectedTier, reason: reason.trim() })}
                    style={{ ...styles.confirmBtn, opacity: saving || !reason.trim() ? 0.6 : 1 }}
                    disabled={saving || !reason.trim()}
                  >
                    {saving ? 'Saving...' : 'Confirm Override'}
                  </button>
                </div>
              </>
            )}

            {/* Admin: confirm toggle */}
            {modalType === 'admin' && (
              <>
                <p style={{ color: '#e6edf3', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  {modalUser.is_admin
                    ? 'This will remove admin privileges from this user. They will no longer be able to access admin pages.'
                    : 'This will grant full admin access to this user. They will be able to manage tiers, users, and configuration.'}
                </p>
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('toggle_admin')}
                    style={{
                      ...styles.confirmBtn,
                      background: modalUser.is_admin ? '#da3633' : '#238636',
                      opacity: saving ? 0.6 : 1,
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : modalUser.is_admin ? 'Revoke Admin' : 'Grant Admin'}
                  </button>
                </div>
              </>
            )}

            {/* Suspend: confirm toggle */}
            {modalType === 'suspend' && (
              <>
                <p style={{ color: '#e6edf3', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  {modalUser.suspended
                    ? 'This will reactivate the user. They will be able to log in again.'
                    : 'This will immediately sign out the user, block all future login attempts, and preserve their data. All active sessions will be invalidated.'}
                </p>
                {!modalUser.suspended && (
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason for suspension (recorded in audit log, not shown to user)"
                    style={styles.textareaInput}
                    disabled={saving}
                  />
                )}
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('toggle_suspension', { reason: reason.trim() || undefined })}
                    style={{
                      ...styles.confirmBtn,
                      background: modalUser.suspended ? '#238636' : '#da3633',
                      opacity: saving ? 0.6 : 1,
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : modalUser.suspended ? 'Unsuspend User' : 'Suspend User'}
                  </button>
                </div>
              </>
            )}

            {/* Reset Demo: confirm */}
            {modalType === 'reset_demo' && (
              <>
                <p style={{ color: '#e6edf3', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                  Reset the 30-day demo trial for this user:
                </p>
                <ul style={{ color: '#8b949e', fontSize: '0.8125rem', marginBottom: '1rem', paddingLeft: '1.25rem' }}>
                  <li>Extends demo expiry to 30 days from now</li>
                  <li>Keeps tier at «demo» (if currently demo)</li>
                </ul>
                {modalUser.demo_expires_at && (
                  <p style={{ color: '#8b949e', fontSize: '0.75rem', marginBottom: '1rem' }}>
                    Current expiry: {formatDate(modalUser.demo_expires_at)}
                  </p>
                )}
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('reset_demo')}
                    style={{ ...styles.confirmBtn, opacity: saving ? 0.6 : 1 }}
                    disabled={saving}
                  >
                    {saving ? 'Resetting...' : 'Reset Demo Trial'}
                  </button>
                </div>
              </>
            )}

            {/* Delete User: confirmation dialog — HIGH STAKES */}
            {modalType === 'delete' && (
              <>
                {modalUser.deleted ? (
                  /* ── RESTORE ── */
                  <>
                    <div
                      style={{
                        background: 'rgba(35,134,54,0.1)',
                        border: '1px solid #238636',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginBottom: '1rem',
                      }}
                    >
                      <p style={{ color: '#3fb950', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
                        ♻️ Restore Account
                      </p>
                      <p style={{ color: '#e6edf3', fontSize: '0.8125rem', margin: 0 }}>
                        This will reactivate <strong>{modalUser.email || modalUser.display_name}</strong>&apos;s account.
                        They will be able to log in again. All their data is intact.
                      </p>
                    </div>
                    <div style={styles.modalActions}>
                      <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                      <button
                        onClick={() => handleAction('restore_user', { reason: reason.trim() || undefined })}
                        style={{
                          ...styles.confirmBtn,
                          background: '#238636',
                          opacity: saving ? 0.6 : 1,
                        }}
                        disabled={saving}
                      >
                        {saving ? 'Restoring...' : 'Restore User'}
                      </button>
                    </div>
                  </>
                ) : (
                  /* ── DELETE ── */
                  <>
                    <div
                      style={{
                        background: 'rgba(218,54,51,0.1)',
                        border: '1px solid #da3633',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginBottom: '1rem',
                      }}
                    >
                      <p style={{ color: '#f85149', fontSize: '0.875rem', fontWeight: 600, marginBottom: '4px' }}>
                        ⚠️ High-Stakes Action
                      </p>
                      <p style={{ color: '#e6edf3', fontSize: '0.8125rem', margin: 0 }}>
                        This will <strong>permanently delete {modalUser.email || modalUser.display_name}&apos;s account</strong>. All data is preserved for audit.
                        The user will be immediately signed out and blocked from logging in.
                      </p>
                    </div>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Reason for deletion (recorded in audit log)"
                      style={styles.textareaInput}
                      disabled={saving}
                    />
                    <div style={styles.modalActions}>
                      <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                      <button
                        onClick={() => handleAction('delete_user', { reason: reason.trim() || undefined })}
                        style={{
                          ...styles.confirmBtn,
                          background: '#da3633',
                          opacity: saving ? 0.6 : 1,
                        }}
                        disabled={saving}
                      >
                        {saving ? 'Deleting...' : 'Delete User'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Reset 2FA: no confirmation needed, just execute */}
            {modalType === 'reset_mfa' && (
              <>
                <p style={{ color: '#e6edf3', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  This will disable 2FA for{' '}
                  <strong style={{ color: '#f0883e' }}>{modalUser.email}</strong>.
                  They will be prompted to set up 2FA again on their next login.
                </p>
                <p style={{ color: '#f0883e', marginBottom: '1.5rem', fontSize: '0.8rem', background: 'rgba(240,136,62,0.08)', padding: '10px 14px', borderRadius: '8px', border: '1px solid rgba(240,136,62,0.2)' }}>
                  ⚠️ Only do this if the user has lost their 2FA device AND backup codes.
                  This action is audit-logged.
                </p>
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('reset_mfa')}
                    style={{
                      ...styles.confirmBtn,
                      background: '#f0883e',
                      color: '#0a0f1e',
                      opacity: saving ? 0.6 : 1,
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Resetting...' : 'Reset 2FA'}
                  </button>
                </div>
              </>
            )}

            {/* Reset Password: no confirmation needed, just execute */}
            {modalType === 'reset_password' && (
              <>
                <p style={{ color: '#e6edf3', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  This will send a password reset link to{' '}
                  <strong style={{ color: '#06b6d4' }}>{modalUser.email}</strong>.
                  The link expires in 24 hours.
                </p>
                <div style={styles.modalActions}>
                  <button onClick={closeModal} style={styles.cancelBtn} disabled={saving}>Cancel</button>
                  <button
                    onClick={() => handleAction('reset_password')}
                    style={{
                      ...styles.confirmBtn,
                      background: '#06b6d4',
                      color: '#0a0f1e',
                      opacity: saving ? 0.6 : 1,
                    }}
                    disabled={saving}
                  >
                    {saving ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Activity Modal ── */}
      {modalUser && modalType === 'activity' && (
        <div style={styles.modalOverlay} onClick={closeModal}>
          <div style={{ ...styles.modal, maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              {modalUser.display_name || modalUser.email?.split('@')[0] || 'User'} Activity
            </h2>
            <p style={{ color: '#8b949e', fontSize: '0.8125rem', marginBottom: '1rem' }}>
              {modalUser.email}
            </p>

            {/* ── Account Overview ── */}
            <div style={sectionStyle}>
              <h4 style={sectionTitle}>Account Overview</h4>
              <div style={grid2Col}>
                <Stat label="Tier" value={modalUser.tier || '—'} highlight />
                <Stat label="Style" value={modalUser.investor_style || '—'} />
                <Stat label="Joined" value={formatDate(modalUser.created_at)} />
                <Stat label="Subscription" value={modalUser.subscription_status || 'none'} />
                {modalUser.tier === 'demo' && (
                  <Stat label="Demo Expires" value={formatDate(modalUser.demo_expires_at)} />
                )}
              </div>
            </div>

            {/* ── Gamification ── */}
            <div style={sectionStyle}>
              <h4 style={sectionTitle}>Gamification</h4>
              <div style={grid3Col}>
                <Stat label="Level" value={String(modalUser.last_level ?? '—')} highlight />
                <Stat label="Total Score" value={String(modalUser.total_score ?? 0)} />
                <Stat label="Milestones" value={String(modalUser.milestones_earned ?? 0)} />
                <Stat label="Current Streak" value={`${modalUser.current_streak ?? 0}d`} />
                <Stat label="Longest Streak" value={`${modalUser.longest_streak ?? 0}d`} />
                <Stat label="Days Active" value={String(modalUser.total_days_active ?? 0)} />
              </div>
            </div>

            {/* ── Activity Metrics ── */}
            <div style={sectionStyle}>
              <h4 style={sectionTitle}>Activity Metrics</h4>
              <div style={grid3Col}>
                <Stat label="Trades" value={String(modalUser.trades_executed ?? 0)} highlight />
                <Stat label="Baskets Created" value={String(modalUser.baskets_created ?? 0)} />
                <Stat label="AI Sessions" value={String(modalUser.ai_sessions ?? 0)} />
                <Stat label="Chat Used" value={String(modalUser.monthly_chat_used ?? 0)} />
              </div>
            </div>

            {/* ── Admin Audit Log ── */}
            <div style={sectionStyle}>
              <h4 style={sectionTitle}>Admin Actions</h4>
              {activityLoading ? (
                <p style={{ color: '#8b949e', textAlign: 'center', padding: '1rem', fontSize: '0.8125rem' }}>Loading...</p>
              ) : activityEntries.length === 0 ? (
                <p style={{ color: '#484f58', textAlign: 'center', padding: '0.75rem', fontSize: '0.8125rem' }}>
                  No admin actions recorded for this user.
                </p>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #30363d' }}>
                        <th style={{ ...styles.th, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>Date</th>
                        <th style={{ ...styles.th, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>Action</th>
                        <th style={{ ...styles.th, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>By</th>
                        <th style={{ ...styles.th, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityEntries.map((entry) => (
                        <tr key={entry.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ ...styles.td, fontSize: '0.6875rem', padding: '0.375rem 0.5rem', color: '#8b949e' }}>
                            {formatDate(entry.created_at)}
                          </td>
                          <td style={{ ...styles.td, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>
                            <span style={auditBadge(entry.action)}>
                              {entry.action}
                            </span>
                          </td>
                          <td style={{ ...styles.td, fontSize: '0.6875rem', padding: '0.375rem 0.5rem', color: '#8b949e' }}>
                            {entry.admin_email}
                          </td>
                          <td style={{ ...styles.td, fontSize: '0.6875rem', padding: '0.375rem 0.5rem' }}>
                            {entry.reason && (
                              <span style={{ color: '#e6edf3' }}>{entry.reason}</span>
                            )}
                            {entry.new_value && (
                              <span style={{ color: '#8b949e', marginLeft: 4 }}>
                                {JSON.stringify(entry.new_value).slice(0, 60)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ ...styles.modalActions, marginTop: '1rem' }}>
              <button onClick={closeModal} style={styles.cancelBtn}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div style={styles.toast(toast.type)}>{toast.message}</div>}
    </div>
  );
}
