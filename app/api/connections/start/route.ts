// ─── POST /api/connections/start — Initiate broker connection ──
// Stub: all connections return "coming_soon" for now.
// Real integrations (Snaptrade, Alpaca, Tastytrade) come in Phase 5/6.

import { requireAuth } from '@/lib/auth/get-server-user';
import { NextRequest, NextResponse } from 'next/server';

const VALID_TYPES = new Set(['snaptrade', 'alpaca', 'tastytrade']);

export async function POST(req: NextRequest) {
  const { authUser, authError } = await requireAuth();
  if (authError) return authError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const connectionType = body?.connection_type as string | undefined;

  if (!connectionType || !VALID_TYPES.has(connectionType)) {
    return NextResponse.json(
      {
        error: 'Invalid connection_type',
        valid: ['snaptrade', 'alpaca', 'tastytrade'],
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    success: false,
    status: 'coming_soon',
    message:
      'Broker connections launching soon. We\'ll notify you when ready.',
    connection_type: connectionType,
  });
}
