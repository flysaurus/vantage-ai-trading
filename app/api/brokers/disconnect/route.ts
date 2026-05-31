import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await requireAuth(req);
    const supabase: any = createServerClient();

    const body = await req.json().catch(() => ({}));
    const { provider } = body as { provider?: string };

    if (!provider) {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 });
    }

    // Step 1: Get credential records to find vault secret IDs
    const { data: creds, error: credsErr } = await supabase
      .from('api_credentials')
      .select('alpaca_api_key_secret_id, alpaca_secret_key_secret_id, tastytrade_api_key_secret_id')
      .eq('user_id', userId)
      .eq('provider', provider)
      .maybeSingle();

    // Step 2: Delete vault secrets (non-critical — proceed even if this fails)
    if (!credsErr && creds) {
      const deleteIds = [
        creds.alpaca_api_key_secret_id,
        creds.alpaca_secret_key_secret_id,
        creds.tastytrade_api_key_secret_id,
      ].filter(Boolean);

      await Promise.all(
        deleteIds.map((id) =>
          supabase.rpc('delete_broker_secret', { p_secret_id: id }).catch(() => {})
        )
      );
    }

    // Step 3: Delete from api_credentials
    await supabase
      .from('api_credentials')
      .delete()
      .eq('user_id', userId)
      .eq('provider', provider);

    // Step 4: Update api_connections to disconnected
    // This trigger will auto-update users.broker_connected = false
    await supabase
      .from('api_connections')
      .update({
        is_connected: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('provider', provider);

    return NextResponse.json({ success: true, message: `${provider} disconnected successfully` });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[Broker Disconnect] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
