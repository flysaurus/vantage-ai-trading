// ─── Admin: Test Cases & Cycles ───────────────────────────────
// Server component — gated behind requireAdmin(), then hands off to the
// client component that owns the paste box, case list and cycle builder.

import { requireAdmin } from '@/lib/auth/admin-check';
import { TestCasesAdmin } from './client';

export default async function AdminTestCasesPage() {
  const { adminError } = await requireAdmin();

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
          <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline text-sm">
            ← Back to Vantage
          </a>
        </div>
      </div>
    );
  }

  return <TestCasesAdmin />;
}
