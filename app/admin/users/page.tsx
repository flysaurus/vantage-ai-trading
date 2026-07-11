// ─── Admin Users Page ────────────────────────────────────────
// Server component — checks admin access server-side, then renders
// the user management + invite management client component.

import { requireAdmin } from '@/lib/auth/admin-check';
import { UsersManager } from './users-manager';
import InviteManager from './invite-manager';
import { UsersPageClient } from './users-page-client';

export default async function UsersAdminPage() {
  const { adminUser, adminError } = await requireAdmin();

  if (adminError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d1117',
          padding: '2rem',
        }}
      >
        <div style={{ maxWidth: '28rem', width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔒</div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#e6edf3',
              marginBottom: '0.5rem',
            }}
          >
            Admin Access Required
          </h1>
          <p style={{ color: '#8b949e', marginBottom: '1rem' }}>
            Your account is not in the admin allowlist.
          </p>
          <a
            href="/"
            style={{
              color: '#58a6ff',
              textDecoration: 'none',
              fontSize: '0.875rem',
            }}
          >
            ← Back to Vantage
          </a>
        </div>
      </div>
    );
  }

  return <UsersPageClient usersContent={<UsersManager />} invitesContent={<InviteManager />} />;
}
