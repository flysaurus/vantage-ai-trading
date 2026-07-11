'use client';

// ─── UsersPageClient — Tab wrapper for Users/Invites ──────────
// Server page passes the two tab contents as ReactNode props.

import { useState, type ReactNode } from 'react';

interface Props {
  usersContent: ReactNode;
  invitesContent: ReactNode;
}

export function UsersPageClient({ usersContent, invitesContent }: Props) {
  const [tab, setTab] = useState<'users' | 'invites'>('users');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1.25rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
    background: 'transparent',
    color: active ? '#e6edf3' : '#8b949e',
    transition: 'color 0.15s, border-color 0.15s',
  });

  return (
    <div>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        gap: 0,
        borderBottom: '1px solid #30363d',
        marginBottom: '1.5rem',
      }}>
        <button onClick={() => setTab('users')} style={tabStyle(tab === 'users')}>
          👥 Users
        </button>
        <button onClick={() => setTab('invites')} style={tabStyle(tab === 'invites')}>
          📨 Invites
        </button>
      </div>

      {/* Tab content */}
      {tab === 'users' ? usersContent : invitesContent}
    </div>
  );
}
