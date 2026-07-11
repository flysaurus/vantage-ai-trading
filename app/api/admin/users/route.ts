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

// ─── Types ────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string | null;
  avatar_url?: string | null;
  investor_style?: string | null;
  investor_style_onboarded?: boolean | null;
  tier?: string | null;
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

export async function PUT(request: NextRequest) {
  try {
    const { adminUser: authUser, adminError } = await requireAdmin(request);
    if (adminError) return adminError;

    const adminEmail = authUser.email || 'unknown';
    const body = await request.json();

    const { userId, tier, reason } = body;

    // ── Validate ──────────────────────────────────────────────
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid userId' },
        { status: 400 }
      );
    }

    const validTiers = ['demo', 'silver', 'gold'];
    if (!tier || !validTiers.includes(tier)) {
      return NextResponse.json(
        { error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return NextResponse.json(
        { error: 'Reason is required for tier override audit trail' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();
    const sb = supabase as any;

    // Step 1: Read current tier
    const { data: currentUser, error: fetchErr } = await sb
      .from('users')
      .select('tier')
      .eq('id', userId)
      .single();

    if (fetchErr) {
      return NextResponse.json(
        { error: `User not found: ${fetchErr.message}` },
        { status: 404 }
      );
    }

    const oldTier = currentUser.tier || null;

    // No-op check
    if (oldTier === tier) {
      return NextResponse.json({
        success: true,
        message: `User already has tier '${tier}'. No change made.`,
        tier,
      });
    }

    // Step 2: Update tier
    const { error: updateErr } = await sb
      .from('users')
      .update({ tier, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (updateErr) {
      return NextResponse.json(
        { error: `Failed to update tier: ${updateErr.message}` },
        { status: 500 }
      );
    }

    // Step 3: Write audit log
    const auditEntry = {
      admin_email: adminEmail,
      target_user_id: userId,
      action: 'tier_override',
      old_value: JSON.parse(JSON.stringify({ tier: oldTier })),
      new_value: JSON.parse(JSON.stringify({ tier })),
      reason: reason.trim(),
      created_at: new Date().toISOString(),
    };

    const { error: auditErr } = await sb
      .from('admin_audit_log')
      .insert(auditEntry);

    if (auditErr) {
      console.error('[admin/users] Audit log write failed:', auditErr.message);
      // Non-fatal — tier was updated, log the failure
    }

    return NextResponse.json({
      success: true,
      message: `Tier changed from '${oldTier || 'none'}' to '${tier}'`,
      userId,
      tier,
      oldTier,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
