import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { getConnectionStatus } from '@/lib/vault';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;
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
