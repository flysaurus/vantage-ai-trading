// ─── Admin API: Users ───────────────────────────────────────
// GET  /api/admin/users  → list all users with aggregated stats
// PUT  /api/admin/users  → override a user's tier with audit logging
//
// Guardrails:
//   1. All endpoints gated with requireAdmin()
//   2. Tier overrides logged to admin_audit_log
//   3. Null-safe handling for users without scores/streaks/subscriptions

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/auth/admin-check';
import { sendResetEmail } from '@/lib/reset-email';
import crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string | null;
  avatar_url?: string | null;
  investor_style?: string | null;
  investor_style_onboarded?: boolean | null;
  tier?: string | null;
  is_admin?: boolean | null;
  suspended?: boolean | null;
  created_at: string;
  updated_at?: string | null;
  monthly_chat_used?: number | null;
  monthly_deep_used?: number | null;
  demo_deep_pool_used?: number | null;
  demo_expires_at?: string | null;
}

interface AggregatedUser {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  investor_style: string | null;
  investor_style_onboarded: boolean | null;
  tier: string | null;
  is_admin: boolean | null;
  suspended: boolean | null;
  subscription_tier_key: string | null;
  subscription_tier_name: string | null;
  subscription_status: string | null;
  total_score: number | null;
  baskets_created: number | null;
  trades_executed: number | null;
  ai_sessions: number | null;
  milestones_earned: number | null;
  last_level: number | null;
  milestone_count: number | null;
  current_streak: number | null;
  longest_streak: number | null;
  total_days_active: number | null;
  monthly_chat_used: number | null;
  monthly_deep_used: number | null;
  demo_deep_pool_used: number | null;
  demo_expires_at: string | null;
  created_at: string;
  updated_at: string | null;
}

// ─── GET ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { adminUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);

    const search = searchParams.get('search') || '';
    const sortField = searchParams.get('sort') || 'created_at';
    const sortOrder = searchParams.get('order') || 'desc';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    // ── Build base query ──────────────────────────────────────
    // Use raw SQL via RPC or chain queries. Since the types may not cover
    // all columns, we use (supabase as any).
    const sb = supabase as any;

    // Fetch users with their scores, streaks, subscriptions, and milestone counts
    // We do this as a server-side aggregation using Supabase queries.
    // The users table is our primary source; we LEFT JOIN everything else.

    // Step 1: Get users
    // Note: display_name may not exist on older Supabase instances —
    // we coalesce it to NULL client-side if the column is missing.
    // Migration 030 adds the column if missing.
    let userQuery = sb
      .from('users')
      .select(`
        id, email, avatar_url,
        investor_style, investor_style_onboarded, tier,
        is_admin, suspended, deleted,
        created_at, updated_at,
        monthly_chat_used, monthly_deep_used,
        demo_deep_pool_used, demo_expires_at
      `)
      .order(sortField, { ascending: sortOrder === 'asc' })
      .limit(limit);

    // Apply email search filter
    if (search) {
      userQuery = userQuery.ilike('email', `%${search}%`);
    }

    const { data: users, error: usersError } = await userQuery;

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    if (!users || users.length === 0) {
      return NextResponse.json({ users: [], total: 0 });
    }

    const userIds = users.map((u: UserRow) => u.id);

    // Step 2: Fetch investor scores for these users
    const { data: scores } = await sb
      .from('investor_scores')
      .select('user_id, total_score, baskets_created, trades_executed, ai_sessions, milestones_earned, last_level')
      .in('user_id', userIds);

    // Step 3: Fetch streaks
    const { data: streaks } = await sb
      .from('streaks')
      .select('user_id, current_streak, longest_streak, total_days_active')
      .in('user_id', userIds);

    // Step 4: Fetch subscriptions (with tier info)
    const { data: subscriptions } = await sb
      .from('user_subscriptions')
      .select('user_id, status, tier_id, subscription_tiers!inner(key, name)')
      .in('user_id', userIds);

    // Step 5: Fetch milestone counts
    const { data: milestoneCounts } = await sb
      .from('milestones')
      .select('user_id')
      .in('user_id', userIds);

    // ── Aggregate ─────────────────────────────────────────────

    // Build lookup maps
    const scoreMap = new Map<string, typeof scores[0]>();
    for (const s of scores || []) {
      scoreMap.set(s.user_id, s);
    }

    const streakMap = new Map<string, typeof streaks[0]>();
    for (const s of streaks || []) {
      streakMap.set(s.user_id, s);
    }

    const subMap = new Map<string, typeof subscriptions[0]>();
    for (const s of subscriptions || []) {
      subMap.set(s.user_id, s);
    }

    // Count milestones per user
    const milestoneCountMap = new Map<string, number>();
    for (const m of milestoneCounts || []) {
      milestoneCountMap.set(m.user_id, (milestoneCountMap.get(m.user_id) || 0) + 1);
    }

    // Merge into aggregated response
    const aggregated: AggregatedUser[] = users.map((u: UserRow) => {
      const score = scoreMap.get(u.id);
      const streak = streakMap.get(u.id);
      const sub = subMap.get(u.id);

      // Extract subscription tier info
      let subscriptionTierKey: string | null = null;
      let subscriptionTierName: string | null = null;
      let subscriptionStatus: string | null = null;
      if (sub && sub.subscription_tiers) {
        // subscription_tiers might be an array if it's a join result
        const tier = Array.isArray(sub.subscription_tiers)
          ? sub.subscription_tiers[0]
          : sub.subscription_tiers;
        if (tier) {
          subscriptionTierKey = tier.key;
          subscriptionTierName = tier.name;
        }
        subscriptionStatus = sub.status;
      }

      // Resolve effective tier: prefer subscription, fall back to users.tier
      const effectiveTier = subscriptionTierKey || u.tier || null;

      return {
        id: u.id,
        email: u.email,
        display_name: null, // display_name column may not exist yet (migration 030)
        avatar_url: u.avatar_url || null,
        investor_style: u.investor_style || null,
        investor_style_onboarded: u.investor_style_onboarded ?? null,
        tier: effectiveTier,
        is_admin: u.is_admin ?? null,
        suspended: u.suspended ?? null,
        deleted: u.deleted ?? null,
        subscription_tier_key: subscriptionTierKey,
        subscription_tier_name: subscriptionTierName,
        subscription_status: subscriptionStatus,
        total_score: score?.total_score ?? null,
        baskets_created: score?.baskets_created ?? null,
        trades_executed: score?.trades_executed ?? null,
        ai_sessions: score?.ai_sessions ?? null,
        milestones_earned: score?.milestones_earned ?? null,
        last_level: score?.last_level ?? null,
        milestone_count: milestoneCountMap.get(u.id) ?? null,
        current_streak: streak?.current_streak ?? null,
        longest_streak: streak?.longest_streak ?? null,
        total_days_active: streak?.total_days_active ?? null,
        monthly_chat_used: u.monthly_chat_used ?? null,
        monthly_deep_used: u.monthly_deep_used ?? null,
        demo_deep_pool_used: u.demo_deep_pool_used ?? null,
        demo_expires_at: u.demo_expires_at || null,
        created_at: u.created_at,
        updated_at: u.updated_at || null,
      };
    });

    return NextResponse.json({
      users: aggregated,
      total: aggregated.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── PUT ──────────────────────────────────────────────────────
// Supports multiple actions via the "action" field:
//   tier_override      — change subscription tier
//   toggle_admin       — grant or revoke is_admin
//   toggle_suspension  — suspend or unsuspend user
//   reset_demo         — reset demo trial (expiry + deep pool counter)
// All actions are audit-logged with old_value / new_value JSONB.

export async function PUT(request: NextRequest) {
  try {
    const { adminUser: authUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const adminEmail = authUser.email || 'unknown';
    const body = await request.json();

    const { userId, action, tier, reason } = body;

    // ── Common validation ────────────────────────────────────
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid userId' },
        { status: 400 }
      );
    }

    if (!action || typeof action !== 'string') {
      return NextResponse.json(
        { error: 'Missing action field. Must be: tier_override, toggle_admin, toggle_suspension, reset_demo' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const sb = supabase as any;

    switch (action) {
      case 'tier_override':
        return handleTierOverride(sb, userId, tier, reason, adminEmail);
      case 'toggle_admin':
        return handleToggleAdmin(sb, userId, adminEmail);
      case 'toggle_suspension':
        return handleToggleSuspension(sb, userId, reason, adminEmail);
      case 'reset_demo':
        return handleResetDemo(sb, userId, adminEmail);
      case 'delete_user':
        return handleSoftDelete(sb, userId, reason, adminEmail);
      case 'restore_user':
        return handleRestoreUser(sb, userId, reason, adminEmail);
      case 'reset_password':
        return handleResetPassword(sb, userId, adminEmail);
      case 'reset_mfa':
        return handleResetMfa(sb, userId, adminEmail);
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Must be: tier_override, toggle_admin, toggle_suspension, reset_demo, delete_user, restore_user, reset_password, reset_mfa` },
          { status: 400 }
        );
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── Action Handlers ─────────────────────────────────────────

async function fetchUser(sb: any, userId: string) {
  const { data: user, error } = await sb
    .from('users')
    .select('id, tier, is_admin, suspended, demo_expires_at, demo_deep_pool_used')
    .eq('id', userId)
    .single();
  if (error) return { error: `User not found: ${error.message}`, status: 404 };
  return { user };
}

async function writeAudit(
  sb: any,
  adminEmail: string,
  targetUserId: string,
  action: string,
  oldValue: any,
  newValue: any,
  reason?: string,
) {
  const { error } = await sb.from('admin_audit_log').insert({
    admin_email: adminEmail,
    target_user_id: targetUserId,
    action,
    old_value: oldValue,
    new_value: newValue,
    reason: reason || null,
    created_at: new Date().toISOString(),
  });
  if (error) {
    console.error(`[admin/users] Audit log write failed (${action}):`, error.message);
  }
}

// ── Tier Override ───────────────────────────────────────────

async function handleTierOverride(
  sb: any,
  userId: string,
  tier: string | undefined,
  reason: string | undefined,
  adminEmail: string,
) {
  const validTiers = ['demo', 'silver', 'gold'];
  if (!tier || !validTiers.includes(tier)) {
    return NextResponse.json(
      { error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` },
      { status: 400 },
    );
  }
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    return NextResponse.json(
      { error: 'Reason is required for tier override audit trail' },
      { status: 400 },
    );
  }

  const result = await fetchUser(sb, userId);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status as any });
  const { user } = result;
  const oldTier = user.tier || null;

  if (oldTier === tier) {
    return NextResponse.json({ success: true, message: `User already has tier '${tier}'. No change made.`, tier });
  }

  await sb.from('users').update({ tier, updated_at: new Date().toISOString() }).eq('id', userId);
  await writeAudit(sb, adminEmail, userId, 'tier_override', { tier: oldTier }, { tier }, reason.trim());

  return NextResponse.json({
    success: true,
    message: `Tier changed from '${oldTier || 'none'}' to '${tier}'`,
    userId, tier, oldTier,
  });
}

// ── Toggle Admin ────────────────────────────────────────────

async function handleToggleAdmin(sb: any, userId: string, adminEmail: string) {
  const result = await fetchUser(sb, userId);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status as any });
  const { user } = result;

  const newValue = !user.is_admin;
  const actionLabel = newValue ? 'grant_admin' : 'revoke_admin';

  await sb.from('users').update({ is_admin: newValue, updated_at: new Date().toISOString() }).eq('id', userId);
  await writeAudit(sb, adminEmail, userId, actionLabel, { is_admin: user.is_admin || false }, { is_admin: newValue });

  return NextResponse.json({
    success: true,
    message: newValue ? 'Admin access granted' : 'Admin access revoked',
    userId, is_admin: newValue,
  });
}

// ── Toggle Suspension ───────────────────────────────────────

async function handleToggleSuspension(
  sb: any,
  userId: string,
  reason: string | undefined,
  adminEmail: string,
) {
  const result = await fetchUser(sb, userId);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status as any });
  const { user } = result;

  const newValue = !user.suspended;
  const actionLabel = newValue ? 'suspend_user' : 'unsuspend_user';

  await sb.from('users').update({ suspended: newValue, updated_at: new Date().toISOString() }).eq('id', userId);
  await writeAudit(sb, adminEmail, userId, actionLabel, { suspended: user.suspended || false }, { suspended: newValue }, reason || undefined);

  // If suspending, invalidate all active sessions via Supabase Auth admin API
  if (newValue) {
    try {
      const { error: sessionErr } = await sb.auth.admin.signOut(userId);
      if (sessionErr) {
        console.error('[admin/users] Failed to sign out user:', sessionErr.message);
      }
    } catch (e: any) {
      console.error('[admin/users] Session invalidation error:', e.message);
    }
  }

  return NextResponse.json({
    success: true,
    message: newValue ? 'User suspended — all active sessions invalidated' : 'User reactivated',
    userId, suspended: newValue,
  });
}

// ── Reset Demo Trial ────────────────────────────────────────

async function handleResetDemo(sb: any, userId: string, adminEmail: string) {
  const result = await fetchUser(sb, userId);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status as any });
  const { user } = result;

  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const oldValues = {
    demo_expires_at: user.demo_expires_at,
    demo_deep_pool_used: user.demo_deep_pool_used,
  };

  await sb.from('users').update({
    demo_expires_at: thirtyDays,
    demo_deep_pool_used: 0,
    tier: user.tier || 'demo',
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  await writeAudit(sb, adminEmail, userId, 'reset_demo',
    oldValues,
    { demo_expires_at: thirtyDays, demo_deep_pool_used: 0 },
  );

  return NextResponse.json({
    success: true,
    message: `Demo trial reset — expires ${new Date(thirtyDays).toLocaleDateString()}`,
    userId,
    demo_expires_at: thirtyDays,
    demo_deep_pool_used: 0,
  });
}

// ── Soft Delete User ──────────────────────────────────────

async function handleSoftDelete(
  sb: any,
  userId: string,
  reason: string | undefined,
  adminEmail: string,
) {
  const { user, error: userErr } = await fetchUser(sb, userId);
  if (userErr) {
    return NextResponse.json(
      { error: userErr.error || 'User not found' },
      { status: userErr.status || 404 },
    );
  }

  // Already deleted — no-op
  if ((user as any).deleted) {
    return NextResponse.json({
      success: true,
      message: 'User is already marked as deleted',
      userId,
      deleted: true,
    });
  }

  const oldValue = { deleted: (user as any).deleted ?? false };
  const newValue = { deleted: true, deleted_at: new Date().toISOString() };

  const { error: updateErr } = await sb
    .from('users')
    .update({ deleted: true, suspended: true, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (updateErr) {
    console.error('[admin/users] Soft delete failed:', updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await writeAudit(sb, adminEmail, userId, 'delete_user', oldValue, newValue, reason);

  return NextResponse.json({
    success: true,
    message: 'User soft-deleted. All data preserved for audit.',
    userId,
    deleted: true,
  });
}

// ── Restore (Undelete) User ──────────────────────────────

async function handleRestoreUser(
  sb: any,
  userId: string,
  reason: string | undefined,
  adminEmail: string,
) {
  const { user, error: userErr } = await fetchUser(sb, userId);
  if (userErr) {
    return NextResponse.json(
      { error: userErr.error || 'User not found' },
      { status: userErr.status || 404 },
    );
  }

  if (!(user as any).deleted) {
    return NextResponse.json({
      success: true,
      message: 'User is not deleted — nothing to restore',
      userId,
    });
  }

  const oldValue = { deleted: true, suspended: (user as any).suspended };
  const newValue = { deleted: false, suspended: false, restored_at: new Date().toISOString() };

  const { error: updateErr } = await sb
    .from('users')
    .update({ deleted: false, suspended: false, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (updateErr) {
    console.error('[admin/users] Restore failed:', updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await writeAudit(sb, adminEmail, userId, 'restore_user', oldValue, newValue, reason);

  return NextResponse.json({
    success: true,
    message: 'User restored. They can now log in again.',
    userId,
    deleted: false,
  });
}

// ── Admin-Initiated Password Reset ─────────────────────────

function generateResetToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

async function handleResetPassword(
  sb: any,
  userId: string,
  adminEmail: string,
) {
  // Fetch the user to get their email
  const { data: user, error: userErr } = await sb
    .from('users')
    .select('id, email')
    .eq('id', userId)
    .single();

  if (userErr || !user?.email) {
    return NextResponse.json(
      { error: 'User not found or has no email' },
      { status: 404 },
    );
  }

  const resetToken = generateResetToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Store the reset token
  try {
    const { error: insertErr } = await sb.from('password_resets').insert({
      user_id: userId,
      email: user.email,
      reset_token: resetToken,
      expires_at: expiresAt,
      created_by: adminEmail,
    });

    if (insertErr) {
      if (insertErr.message?.includes('does not exist')) {
        return NextResponse.json(
          { error: 'password_resets table not created yet. Run migration 036.' },
          { status: 500 },
        );
      }
      console.error('[admin/users] Reset token insert failed:', insertErr.message);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  // Send the email (fire-and-forget)
  sendResetEmail(user.email, resetToken).catch((e) =>
    console.error('[admin/users] Reset email failed for', user.email, e.message)
  );

  // Audit log
  await writeAudit(sb, adminEmail, userId, 'reset_password', null, {
    reset_token_sent: true,
    expires_at: expiresAt,
  });

  return NextResponse.json({
    success: true,
    message: `Password reset link sent to ${user.email}`,
    userId,
  });
}

async function handleResetMfa(
  sb: any,
  userId: string,
  adminEmail: string,
) {
  const user = await fetchUserForReset(sb, userId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  await sb.from('users').update({
    mfa_enabled: false,
    mfa_method: null,
    totp_secret: null,
    backup_codes: null,
    wrong_mfa_attempts: 0,
    mfa_locked_until: null,
  }).eq('id', userId);

  // Audit log
  await writeAudit(sb, adminEmail, userId, 'reset_mfa', null, {
    previous_mfa_method: user.mfa_method || 'none',
  });

  console.log('[admin/users] Admin', adminEmail, 'reset MFA for user', userId);

  return NextResponse.json({
    success: true,
    message: `2FA reset for ${user.email}. They will be prompted to set up 2FA on next login.`,
    userId,
  });
}

async function fetchUserForReset(sb: any, userId: string) {
  const { data: user } = await sb.from('users')
    .select('id, email, mfa_enabled, mfa_method')
    .eq('id', userId)
    .limit(1);
  return user?.[0] || null;
}
