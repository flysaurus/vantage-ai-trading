// ─── GET /api/debug/auth?email=mparikh01@yahoo.com ──────────────
// Diagnostic endpoint to verify Supabase auth connectivity and user status.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const email = searchParams.get('email') || '';

  const results: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'present' : 'MISSING',
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'present' : 'MISSING',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'MISSING',
    },
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ ...results, error: 'Missing Supabase env vars' }, { status: 500 });
  }

  // 1. Test basic auth health
  try {
    const healthRes = await fetch(`${supabaseUrl}/auth/v1/health`);
    results.authHealth = { status: healthRes.status, ok: healthRes.ok };
  } catch (err: any) {
    results.authHealth = { error: err.message };
  }

  // 2. Check if user exists in auth.users
  if (email) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // List auth users via admin API
      const adminRes = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?per_page=100`,
        {
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
          },
          signal: AbortSignal.timeout(8000),
        }
      );

      if (adminRes.ok) {
        const data = await adminRes.json();
        const users = (data.users || data || []) as any[];
        const matched = users.find((u: any) =>
          u.email?.toLowerCase() === email.toLowerCase()
        );
        if (matched) {
          results.user = {
            found: true,
            id: matched.id,
            email: matched.email,
            emailConfirmedAt: matched.email_confirmed_at || null,
            createdAt: matched.created_at,
            lastSignInAt: matched.last_sign_in_at || 'never',
            banned: matched.banned_until || false,
            totalAuthUsers: users.length,
          };

          // Check public.users table
          const { data: pubUser, error: pubErr } = await (supabase as any)
            .from('users')
            .select('id, email, investor_style, investor_style_onboarded, created_at')
            .eq('id', matched.id)
            .single();

          results.publicUser = pubErr
            ? { found: false, error: pubErr.message }
            : { found: !!pubUser, data: pubUser };
        } else {
          results.user = {
            found: false,
            totalAuthUsers: users.length,
            firstFewEmails: users.slice(0, 3).map((u: any) => u.email),
          };
        }
      } else {
        const errText = await adminRes.text().catch(() => 'unknown');
        results.adminApiError = { status: adminRes.status, text: errText.substring(0, 300) };
      }
    } catch (err: any) {
      results.userError = err.message;
    }
  }

  // 3. Test email sending (check if SMTP is configured)
  try {
    const configRes = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    if (configRes.ok) {
      const config = await configRes.json();
      results.authConfig = {
        externalEmailEnabled: config.EXTERNAL_EMAIL_ENABLED,
        mailerAutoconfirm: config.MAILER_AUTOCONFIRM,
        disableSignup: config.DISABLE_SIGNUP,
        smtpAdminEmail: config.SMTP_ADMIN_EMAIL,
        smtpHost: config.SMTP_HOST,
        smtpPort: config.SMTP_PORT,
      };
    } else {
      results.authConfigError = `Status ${configRes.status}`;
    }
  } catch (err: any) {
    results.authConfigError = err.message;
  }

  return NextResponse.json(results);
}
