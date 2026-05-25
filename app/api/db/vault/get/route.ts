import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

function getEncryptionKey(): string {
  return process.env.VAULT_ENCRYPTION_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'vantage-default-secret';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId: authUserId } = await requireAuth(req);
    const supabase = createServerClient();
    const keyName = req.nextUrl.searchParams.get('keyName');
    const targetUserId = req.nextUrl.searchParams.get('userId') || authUserId;
    if (!keyName?.trim()) return NextResponse.json({ error: 'keyName required' }, { status: 400 });
    if (targetUserId !== authUserId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { data, error } = await (supabase as any).from('vault')
      .select('encrypted_api_key, encrypted_secret_key, master_password_hash')
      .eq('user_id', targetUserId).maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to fetch vault', detail: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'No vault entry found' }, { status: 404 });

    const isApiKey = keyName.toUpperCase() === 'ALPACA_API_KEY';
    const isSecret = keyName.toUpperCase() === 'ALPACA_SECRET_KEY';
    let encrypted: string | null = null;

    if (isApiKey) encrypted = data.encrypted_api_key;
    else if (isSecret) encrypted = data.encrypted_secret_key;
    else {
      // generic: stored as "keyName:encrypted" in master_password_hash
      const hash = data.master_password_hash || '';
      if (hash.startsWith(`${keyName}:`)) encrypted = hash.slice(keyName.length + 1);
      else encrypted = null;
    }

    if (!encrypted) return NextResponse.json({ error: `Secret '${keyName}' not found` }, { status: 404 });

    // Decrypt with AES
    const CryptoJS = await import('crypto-js');
    const encKey = getEncryptionKey();
    const decrypted = CryptoJS.AES.decrypt(encrypted, encKey).toString(CryptoJS.enc.Utf8);

    return NextResponse.json({ keyName, value: decrypted });
  } catch (err: any) {
    if (err?.name === 'AuthError') return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
