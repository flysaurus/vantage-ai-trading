'use client';

// ─── InviteManager — Admin UI for invite-only signup gate ──────
// Generate invites, view status, revoke/resend.

import { useState, useEffect } from 'react';

interface InviteRow {
  id: string;
  email: string;
  invite_token: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  created_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  pending: { background: 'rgba(234,179,8,0.15)', color: '#facc15', border: '1px solid rgba(234,179,8,0.3)' },
  accepted: { background: 'rgba(35,134,54,0.15)', color: '#3fb950', border: '1px solid rgba(35,134,54,0.3)' },
  expired: { background: 'rgba(139,148,158,0.1)', color: '#8b949e', border: '1px solid rgba(139,148,158,0.2)' },
  revoked: { background: 'rgba(218,54,51,0.1)', color: '#f85149', border: '1px solid rgba(218,54,51,0.2)' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function inviteLink(token: string): string {
  const base = (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/create-account?invite=${token}`;
}

export default function InviteManager() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  // Create form state
  const [newEmail, setNewEmail] = useState('');
  const [bulkEmails, setBulkEmails] = useState('');
  const [expiryDays, setExpiryDays] = useState(30);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchInvites = async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = filter !== 'all' ? `&status=${filter}` : '';
      const res = await fetch(`/api/admin/invites?limit=100${statusParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setInvites(data.invites || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInvites(); }, [filter]);

  const handleCreateSingle = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [newEmail.trim()], expiryDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.created?.length) {
        setCreateResult(`✅ Invite created for ${data.created[0].email}`);
        setNewEmail('');
      } else if (data.skipped?.length) {
        setCreateResult(`⚠️ ${data.skipped[0]}`);
      }
      fetchInvites();
    } catch (e: any) {
      setCreateResult(`❌ ${e.message}`);
    } finally {
      setCreating(false);
      setTimeout(() => setCreateResult(null), 5000);
    }
  };

  const handleBulkCreate = async () => {
    const emails = bulkEmails
      .split(/[\n,]/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!emails.length) return;
    setCreating(true);
    setCreateResult(null);
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, expiryDays }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const parts: string[] = [];
      if (data.created?.length) parts.push(`✅ ${data.created.length} invited`);
      if (data.skipped?.length) parts.push(`⚠️ ${data.skipped.length} skipped`);
      setCreateResult(parts.join(' · ') || 'No invites created');
      if (data.created?.length) setBulkEmails('');
      fetchInvites();
    } catch (e: any) {
      setCreateResult(`❌ ${e.message}`);
    } finally {
      setCreating(false);
      setTimeout(() => setCreateResult(null), 5000);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId, action: 'revoke' }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchInvites();
    } catch (e: any) {
      alert('Failed to revoke: ' + e.message);
    }
  };

  const handleResend = async (inviteId: string) => {
    try {
      const res = await fetch('/api/admin/invites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId, action: 'resend' }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      fetchInvites();
    } catch (e: any) {
      alert('Failed to resend: ' + e.message);
    }
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch {
      // Fallback for older browsers
    }
  };

  const pendingCount = invites.filter((i) => i.status === 'pending').length;

  // ── Styles ──
  const s = {
    card: { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '1.5rem', marginBottom: '1.5rem' } as React.CSSProperties,
    sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#e6edf3', marginBottom: '1rem' } as React.CSSProperties,
    input: { background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, padding: '0.5rem 0.75rem', color: '#e6edf3', fontSize: '0.875rem', width: '100%', boxSizing: 'border-box' as any } as React.CSSProperties,
    btn: { background: '#238636', color: '#fff', border: 'none', borderRadius: 6, padding: '0.5rem 1rem', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
    btnDanger: { background: '#da3633', color: '#fff', border: 'none', borderRadius: 6, padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' } as React.CSSProperties,
    btnSecondary: { background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 6, padding: '0.25rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' } as React.CSSProperties,
    badge: (status: string): React.CSSProperties => ({
      display: 'inline-block',
      padding: '0.0625rem 0.5rem',
      borderRadius: 12,
      fontSize: '0.6875rem',
      fontWeight: 600,
      textTransform: 'capitalize',
      ...STATUS_STYLES[status],
    }),
    tableHeader: { textAlign: 'left' as const, padding: '0.5rem', color: '#8b949e', fontSize: '0.75rem', fontWeight: 600, borderBottom: '1px solid #30363d' },
    tableCell: { padding: '0.5rem', fontSize: '0.8125rem', color: '#c9d1d9', borderBottom: '1px solid #21262d', verticalAlign: 'middle' as const },
  };

  return (
    <div>
      {/* ── Status bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <span style={{ color: '#e6edf3', fontSize: '1.25rem', fontWeight: 700 }}>📨 Invites</span>
        {pendingCount > 0 && (
          <span style={{ ...s.badge('pending') }}>{pendingCount} pending</span>
        )}
      </div>

      {/* ── Create Invite ── */}
      <div style={s.card}>
        <div style={s.sectionTitle}>Create Invite</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
              Single email
            </label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="user@example.com"
              style={s.input}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateSingle()}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
              Expiry (days)
            </label>
            <input
              type="number"
              value={expiryDays}
              onChange={(e) => setExpiryDays(Math.max(1, parseInt(e.target.value) || 30))}
              min={1}
              max={365}
              style={{ ...s.input, width: 80 }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
          <button onClick={handleCreateSingle} disabled={creating || !newEmail.trim()} style={{ ...s.btn, opacity: creating || !newEmail.trim() ? 0.5 : 1 }}>
            {creating ? 'Creating...' : 'Create Invite'}
          </button>
          {createResult && <span style={{ fontSize: '0.8125rem', color: '#8b949e' }}>{createResult}</span>}
        </div>

        {/* Bulk create */}
        <div style={{ borderTop: '1px solid #21262d', paddingTop: '0.75rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
            Bulk invite (one email per line, or comma-separated)
          </label>
          <textarea
            value={bulkEmails}
            onChange={(e) => setBulkEmails(e.target.value)}
            placeholder={'alice@example.com\nbob@example.com'}
            rows={3}
            style={{ ...s.input, resize: 'vertical' }}
          />
          <button
            onClick={handleBulkCreate}
            disabled={creating || !bulkEmails.trim()}
            style={{ ...s.btn, marginTop: '0.5rem', opacity: creating || !bulkEmails.trim() ? 0.5 : 1 }}
          >
            {creating ? 'Creating...' : `Bulk Invite (${bulkEmails.split(/[\n,]/).filter((e) => e.trim()).length})`}
          </button>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {['all', 'pending', 'accepted', 'expired', 'revoked'].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...s.btnSecondary,
              background: filter === f ? '#1f6feb' : '#21262d',
              color: filter === f ? '#fff' : '#8b949e',
              border: filter === f ? '1px solid #1f6feb' : '1px solid #30363d',
              padding: '0.375rem 0.75rem',
              textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* ── Invite table ── */}
      {loading ? (
        <p style={{ color: '#8b949e', textAlign: 'center', padding: '2rem' }}>Loading...</p>
      ) : error ? (
        <p style={{ color: '#f85149', textAlign: 'center', padding: '2rem' }}>{error}</p>
      ) : invites.length === 0 ? (
        <p style={{ color: '#484f58', textAlign: 'center', padding: '2rem', fontSize: '0.875rem' }}>
          No invites found{filter !== 'all' ? ` with status "${filter}"` : ''}.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid #30363d' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#161b22' }}>
            <thead>
              <tr>
                <th style={s.tableHeader}>Email</th>
                <th style={s.tableHeader}>Status</th>
                <th style={s.tableHeader}>Token</th>
                <th style={s.tableHeader}>Created By</th>
                <th style={s.tableHeader}>Expires</th>
                <th style={s.tableHeader}>Accepted</th>
                <th style={{ ...s.tableHeader, textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id}>
                  <td style={s.tableCell}>{inv.email}</td>
                  <td style={s.tableCell}>
                    <span style={s.badge(inv.status)}>{inv.status}</span>
                  </td>
                  <td style={{ ...s.tableCell, fontFamily: 'monospace', fontSize: '0.6875rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <code
                      style={{ cursor: 'pointer', color: '#58a6ff' }}
                      onClick={() => copyToken(inv.invite_token)}
                      title="Click to copy token"
                    >
                      {inv.invite_token.slice(0, 16)}...
                    </code>
                    {copiedToken === inv.invite_token && (
                      <span style={{ color: '#3fb950', fontSize: '0.625rem', marginLeft: 4 }}>Copied!</span>
                    )}
                  </td>
                  <td style={s.tableCell}>{inv.created_by}</td>
                  <td style={{ ...s.tableCell, color: '#8b949e', fontSize: '0.75rem' }}>
                    {formatDate(inv.expires_at)}
                  </td>
                  <td style={{ ...s.tableCell, color: '#8b949e', fontSize: '0.75rem' }}>
                    {formatDate(inv.accepted_at)}
                  </td>
                  <td style={{ ...s.tableCell, textAlign: 'center' }}>
                    {inv.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                        <button onClick={() => handleResend(inv.id)} style={s.btnSecondary}>
                          Resend
                        </button>
                        <button onClick={() => handleRevoke(inv.id)} style={s.btnDanger}>
                          Revoke
                        </button>
                      </div>
                    )}
                    {inv.status !== 'pending' && (
                      <span style={{ color: '#484f58', fontSize: '0.6875rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
