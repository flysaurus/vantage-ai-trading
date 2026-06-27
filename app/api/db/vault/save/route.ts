import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { storeCredentials } from '@/lib/vault';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const authUserId = authUser!.id;

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { userId, brokerId, credentials } = body as {
      userId?: string;
      brokerId?: string;
      credentials?: Record<string, unknown>;
    };

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }
    if (!brokerId) {
      return NextResponse.json({ error: 'brokerId required' }, { status: 400 });
    }
    if (!credentials || typeof credentials !== 'object') {
      return NextResponse.json({ error: 'credentials object required' }, { status: 400 });
    }
    if (userId !== authUserId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Encrypt and store credentials — this is the only path to persist keys
    await storeCredentials(userId, brokerId, credentials);

    return NextResponse.json({ success: true, brokerId });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AuthError') {
      const authErr = err as Error & { status?: number };
      return NextResponse.json({ error: authErr.message }, { status: authErr.status || 401 });
    }
    console.error('[Vault Save API] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
