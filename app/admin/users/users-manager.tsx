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
  monthly_deep_used: number | null;
  demo_deep_pool_used: number | null;
  demo_expires_at: string | null;
  created_at: string;
  updated_at: string | null;
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
  const [selectedTier, setSelectedTier] = useState<string>('demo');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

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

  // ── Tier override ───────────────────────────────────────────

  const openTierModal = (user: AggregatedUser) => {
    setModalUser(user);
    setSelectedTier(user.tier || 'demo');
    setReason('');
    setSaving(false);
  };

  const closeTierModal = () => {
    setModalUser(null);
    setReason('');
  };

  const handleTierOverride = async () => {
    if (!modalUser) return;
    if (!reason.trim()) {
      setToast({ message: 'Please provide a reason for the tier override.', type: 'error' });
      setTimeout(() => setToast(null), 4000);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: modalUser.id,
          tier: selectedTier,
          reason: reason.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setToast({ message: data.message || 'Tier updated successfully', type: 'success' });
      closeTierModal();
      fetchUsers();
    } catch (e: any) {
      setToast({ message: e.message || 'Failed to update tier', type: 'error' });
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
                      <div style={{ fontSize: '0.6875rem' }}>
                        <span style={{ color: '#8b949e' }}>Deep:</span>{' '}
                        {formatNumber(u.monthly_deep_used)}
                      </div>
                      {u.tier === 'demo' && (
                        <div style={{ fontSize: '0.6875rem' }}>
                          <span style={{ color: '#8b949e' }}>Pool:</span>{' '}
                          {formatNumber(u.demo_deep_pool_used)}
                        </div>
                      )}
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#8b949e', fontSize: '0.75rem' }}>
                        {formatDate(u.created_at)}
                      </span>
                    </td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <button
                        onClick={() => openTierModal(u)}
                        style={styles.actionBtn}
                      >
                        Edit Tier
                      </button>
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
                <span style={styles.cardLabel}>Deep Used</span>
                <span>{formatNumber(u.monthly_deep_used)}</span>
              </div>
              {u.tier === 'demo' && (
                <div style={styles.cardRow}>
                  <span style={styles.cardLabel}>Deep Pool</span>
                  <span>{formatNumber(u.demo_deep_pool_used)}</span>
                </div>
              )}
              <div style={styles.cardRow}>
                <span style={styles.cardLabel}>Created</span>
                <span>{formatDate(u.created_at)}</span>
              </div>
              <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                <button onClick={() => openTierModal(u)} style={styles.actionBtn}>
                  Edit Tier
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Tier Override Modal ── */}
      {modalUser && (
        <div style={styles.modalOverlay} onClick={closeTierModal}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>Edit Tier</h2>
            <p style={{ color: '#8b949e', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              User:{' '}
              <strong style={{ color: '#e6edf3' }}>
                {modalUser.display_name || modalUser.email}
              </strong>
            </p>
            <p style={{ color: '#8b949e', fontSize: '0.875rem', marginBottom: '1rem' }}>
              Current tier:{' '}
              <span style={styles.tierBadge(modalUser.tier)}>
                {modalUser.tier || 'unknown'}
              </span>
            </p>

            {/* Radio Buttons */}
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

            {/* Reason */}
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

            {/* Actions */}
            <div style={styles.modalActions}>
              <button onClick={closeTierModal} style={styles.cancelBtn} disabled={saving}>
                Cancel
              </button>
              <button
                onClick={handleTierOverride}
                style={{
                  ...styles.confirmBtn,
                  opacity: saving ? 0.6 : 1,
                }}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Confirm Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div style={styles.toast(toast.type)}>{toast.message}</div>}
    </div>
  );
}
