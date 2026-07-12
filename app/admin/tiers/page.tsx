// ─── Admin Tier Limits & Model Access Config ──────────────────
// Server component — checks admin access server-side, then renders
// the editor for tier feature values. V1 scope: AI limits + model
// access only. Gamification config is OUT OF SCOPE.

import { requireAdmin } from '@/lib/auth/admin-check';
import { TiersEditor } from './editor';

export default async function TiersAdminPage() {
  const { adminUser, adminError } = await requireAdmin();

  if (adminError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-8">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Admin Access Required
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            Your account is not in the admin allowlist.
          </p>
          <a
            href="/?tab=settings"
            className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
          >
            ← Back to Settings
          </a>
        </div>
      </div>
    );
  }

  return <TiersEditor />;
}
