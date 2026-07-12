'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Check, X, RefreshCw, Loader2, UserPlus, Clock, UserCheck, UserX } from 'lucide-react';

interface AccessRequest {
  id: string;
  email: string;
  name: string | null;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected';
  auto_approve: boolean;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({ pending: 0, approved: 0, rejected: 0 });
  const [filter, setFilter] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusParam = filter !== 'all' ? `&status=${filter}` : '';
      const res = await fetch(`/api/access-requests?limit=200${statusParam}`);
      const data = await res.json();

      if (res.ok) {
        setRequests(data.requests || []);
        if (data.counts) setCounts(data.counts);
        if (data.note) setError(data.note);
      } else {
        setError(data.error || 'Failed to load requests');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/access-requests/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok) {
        fetchRequests();
      } else {
        setError(data.error || 'Action failed');
      }
    } catch (e: any) {
      setError(e.message);
    }
    setActionLoading(null);
  };

  const formatDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const tabs = [
    { key: 'pending', label: 'Pending', icon: Clock, count: counts.pending },
    { key: 'approved', label: 'Approved', icon: UserCheck, count: counts.approved },
    { key: 'rejected', label: 'Rejected', icon: UserX, count: counts.rejected },
    { key: 'all', label: 'All', icon: UserPlus, count: requests.length },
  ];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 900, margin: '0 auto', color: '#c9d1d9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: '#f0f6fc' }}>Access Requests</h1>
        <button
          onClick={fetchRequests}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid #30363d',
            color: '#8b949e',
            borderRadius: 6,
            padding: '6px 12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.8rem',
          }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = filter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              style={{
                background: active ? 'rgba(88,166,255,0.15)' : 'rgba(255,255,255,0.04)',
                border: active ? '1px solid #58a6ff' : '1px solid #30363d',
                color: active ? '#58a6ff' : '#8b949e',
                borderRadius: 8,
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: active ? 600 : 400,
              }}
            >
              <Icon size={14} />
              {tab.label}
              <span style={{
                background: active ? '#58a6ff' : 'rgba(255,255,255,0.1)',
                color: active ? '#fff' : '#8b949e',
                borderRadius: '50%',
                minWidth: 20,
                height: 20,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                padding: '0 4px',
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: 'rgba(218,54,51,0.1)', border: '1px solid #da3633', borderRadius: 8, padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem', color: '#f85149' }}>
          {error}
        </div>
      )}

      {/* Requests list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: '#8b949e' }}>
          <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e', fontSize: '0.9rem' }}>
          No {filter !== 'all' ? filter : ''} requests found.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {requests.map((req) => (
            <div
              key={req.id}
              style={{
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 10,
                padding: '14px 18px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: '#f0f6fc', fontSize: '0.9rem' }}>{req.email}</span>
                  {req.name && (
                    <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>({req.name})</span>
                  )}
                  <span style={{
                    fontSize: '0.7rem',
                    color: '#8b949e',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 4,
                    padding: '1px 6px',
                  }}>
                    {formatDate(req.requested_at)}
                  </span>
                </div>
                {req.reason && (
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {req.reason}
                  </p>
                )}
                {req.status !== 'pending' && req.reviewed_by && (
                  <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: '#484f58' }}>
                    {req.status === 'approved' ? '✓' : '✗'} by {req.reviewed_by} · {formatDate(req.reviewed_at!)}
                  </p>
                )}
              </div>

              {/* Actions */}
              {req.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => handleAction(req.id, 'approve')}
                    disabled={actionLoading === req.id}
                    style={{
                      background: '#238636',
                      border: 'none',
                      color: '#fff',
                      borderRadius: 6,
                      padding: '6px 14px',
                      cursor: actionLoading === req.id ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      opacity: actionLoading === req.id ? 0.6 : 1,
                    }}
                  >
                    {actionLoading === req.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                    Approve
                  </button>
                  <button
                    onClick={() => handleAction(req.id, 'reject')}
                    disabled={actionLoading === req.id}
                    style={{
                      background: 'rgba(218,54,51,0.15)',
                      border: '1px solid #da3633',
                      color: '#f85149',
                      borderRadius: 6,
                      padding: '6px 14px',
                      cursor: actionLoading === req.id ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      opacity: actionLoading === req.id ? 0.6 : 1,
                    }}
                  >
                    {actionLoading === req.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <X size={14} />}
                    Reject
                  </button>
                </div>
              )}

              {/* Status badge for non-pending */}
              {req.status !== 'pending' && (
                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: req.status === 'approved' ? '#3fb950' : '#f85149',
                  background: req.status === 'approved' ? 'rgba(63,185,80,0.1)' : 'rgba(218,54,51,0.1)',
                  borderRadius: 6,
                  padding: '3px 10px',
                  flexShrink: 0,
                }}>
                  {req.status === 'approved' ? '✓ Approved' : '✗ Rejected'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
