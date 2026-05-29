import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getConnectionStatus } from '@/lib/vault';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;

    if (targetUserId !== authUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Return connection status WITHOUT ever decrypting credentials
    const status = await getConnectionStatus(targetUserId);

    return NextResponse.json({
      connected: status.connected,
      brokerId: status.brokerId,
      connectedAt: status.connectedAt,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Vault Get API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
