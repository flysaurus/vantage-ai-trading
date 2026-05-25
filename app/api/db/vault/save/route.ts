import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

function getEncryptionKey(): string {
  return process.env.VAULT_ENCRYPTION_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'vantage-default-secret';
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    const { userId, keyName, value } = body as { userId?: string; keyName?: string; value?: string };
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    if (!keyName?.trim()) return NextResponse.json({ error: 'keyName required' }, { status: 400 });
    if (!value) return NextResponse.json({ error: 'value required' }, { status: 400 });
    if (userId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Encrypt with AES using crypto-js
    const CryptoJS = await import('crypto-js');
    const encKey = getEncryptionKey();
    const encrypted = CryptoJS.AES.encrypt(value, encKey).toString();

    // Map keyName to existing vault column or store as generic
    const now = new Date().toISOString();
    const isApiKey = keyName.toUpperCase() === 'ALPACA_API_KEY';
    const isSecret = keyName.toUpperCase() === 'ALPACA_SECRET_KEY';

    const upsertPayload: Record<string, any> = { user_id: userId, updated_at: now };
    if (isApiKey) upsertPayload.encrypted_api_key = encrypted;
    else if (isSecret) upsertPayload.encrypted_secret_key = encrypted;
    else upsertPayload.master_password_hash = `${keyName}:${encrypted}`;

    const { error } = await (supabase as any).from('vault').upsert(upsertPayload, { onConflict: 'user_id' });
    if (error) return NextResponse.json({ error: 'Failed to save secret', detail: error.message }, { status: 500 });

    return NextResponse.json({ success: true, keyName });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
