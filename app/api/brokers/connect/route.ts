import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/get-server-user';
import { createServerClient } from '@/lib/supabase';
import { verifyAlpacaCredentials } from '@/lib/broker-service';

const ALPACA_PAPER = 'https://paper-api.alpaca.markets';
const ALPACA_LIVE = 'https://api.alpaca.markets';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { authUser, authError } = await requireAuth();
  if (authError) return authError;
  const userId = authUser!.id;
    const supabase: any = createServerClient();

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Missing request body' }, { status: 400 });
    }

    const { provider, apiKey, secretKey, environment } = body as {
      provider?: string;
      apiKey?: string;
      secretKey?: string;
      environment?: string;
    };

    if (!provider || !['alpaca', 'tastytrade'].includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid or missing provider. Supported: alpaca, tastytrade.' },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'apiKey is required' }, { status: 400 });
    }
    if (!secretKey && provider === 'alpaca') {
      return NextResponse.json({ error: 'secretKey is required for Alpaca' }, { status: 400 });
    }

    const env =
      environment === 'live' ? 'live' : provider === 'alpaca' ? 'paper' : 'sandbox';
    let accountNumber: string | undefined;

    // Step 1: Verify credentials BEFORE storing
    if (provider === 'alpaca') {
      const baseUrl = env === 'live' ? ALPACA_LIVE : ALPACA_PAPER;
      const verification = await verifyAlpacaCredentials({
        provider: 'alpaca',
        alpacaApiKey: apiKey,
        alpacaSecretKey: secretKey,
        alpacaBaseUrl: baseUrl,
      });

      if (!verification.valid) {
        return NextResponse.json(
          {
            error: 'Invalid API keys. Please check and try again.',
            detail: verification.error,
          },
          { status: 400 }
        );
      }
      accountNumber = verification.accountNumber;
    }

    // Step 2: Delete old vault secrets for this user (cleanup)
    try {
      const { data: existingCreds } = await supabase
        .from('api_credentials')
        .select(
          'alpaca_api_key_secret_id, alpaca_secret_key_secret_id, tastytrade_api_key_secret_id'
        )
        .eq('user_id', userId)
        .maybeSingle();

      if (existingCreds) {
        const deleteIds = [
          existingCreds.alpaca_api_key_secret_id,
          existingCreds.alpaca_secret_key_secret_id,
          existingCreds.tastytrade_api_key_secret_id,
        ].filter(Boolean);

        await Promise.all(
          deleteIds.map((id) =>
            supabase.rpc('delete_broker_secret', { p_secret_id: id }).catch(() => {})
          )
        );
      }
    } catch {
      // Cleanup failure is non-critical
    }

    // Step 3: Store keys in Vault via RPC
    const secretName = (field: string) => `user_${userId}_${provider}_${field}`;

    let apiKeySecretId: string | null = null;
    let secretKeySecretId: string | null = null;

    // Store API key
    const { data: keyResult } = await supabase.rpc('store_broker_secret', {
      p_secret_value: apiKey,
      p_secret_name: secretName('api_key'),
    });
    apiKeySecretId = keyResult as unknown as string;

    // Store secret key (Alpaca only)
    if (secretKey && provider === 'alpaca') {
      const { data: secResult } = await supabase.rpc('store_broker_secret', {
        p_secret_value: secretKey,
        p_secret_name: secretName('secret_key'),
      });
      secretKeySecretId = secResult as unknown as string;
    }

    // Step 4: Save secret IDs to api_credentials
    const now = new Date().toISOString();
    const credsUpsert: any = {
      user_id: userId,
      provider,
      is_active: true,
      encrypted_at: now,
      updated_at: now,
    };

    if (provider === 'alpaca') {
      credsUpsert.alpaca_api_key_secret_id = apiKeySecretId;
      credsUpsert.alpaca_secret_key_secret_id = secretKeySecretId;
      credsUpsert.alpaca_base_url = env === 'live' ? ALPACA_LIVE : ALPACA_PAPER;
    } else {
      credsUpsert.tastytrade_api_key_secret_id = apiKeySecretId;
      credsUpsert.tastytrade_account_number = accountNumber;
    }

    await supabase
      .from('api_credentials')
      .upsert(credsUpsert, { onConflict: 'user_id,provider' });

    // Step 5: Update api_connections (trigger auto-updates users.broker_connected)
    await supabase.from('api_connections').upsert(
      {
        user_id: userId,
        provider,
        is_connected: true,
        connection_verified: true,
        verified_at: now,
        account_number: accountNumber || null,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    );

    return NextResponse.json({
      success: true,
      provider,
      accountNumber: accountNumber || null,
      message: `${provider} connected and verified successfully`,
    });
  } catch (err: any) {
    if (err?.name === 'AuthError') {
      return NextResponse.json({ error: err.message }, { status: err.status || 401 });
    }
    console.error('[Broker Connect] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
