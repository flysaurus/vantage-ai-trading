// ─── Public Test Runner ───────────────────────────────────────
// PUBLIC — no auth. Anyone with the cycle link can run it on a phone.

import { TestRunner } from './client';

export const dynamic = 'force-dynamic';

export default async function PublicTestRunnerPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  return <TestRunner cycleId={cycleId} />;
}
