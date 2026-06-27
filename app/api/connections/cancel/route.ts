// ─── POST /api/connections/cancel — Cancel broker connection ──
// Stub: returns success without modifying DB.
// Real cancellation logic comes when connections are live (Phase 5/6).

import { requireAuth } from '@/lib/auth/get-server-user';
import { NextResponse } from 'next/server';

export async function POST() {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  return NextResponse.json({
    success: true,
    message: 'Connection cancelled.',
  });
}
