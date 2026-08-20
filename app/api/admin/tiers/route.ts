// ─── Admin Tier Config API ────────────────────────────────────
// GET  /api/admin/tiers → all tier feature values + model access
// PUT  /api/admin/tiers → update tier feature values
//
// Every request is gated behind requireAdmin().

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

// ─── Feature keys visible in the admin UI ─────────────────────
// V1: AI tier limits + model access only.
// Gamification config is OUT OF SCOPE — do not add pillar weights here.

const EDITABLE_FEATURES = [
  'ai_message_limit',
  'monthly_chat_limit',
  'model_access',
] as const;

interface TierInfo {
  id: string;
  key: string;
  name: string;
}

interface FeatureValue {
  tier_id: string;
  feature_key: string;
  value: string;
}

interface TierConfig {
  tiers: TierInfo[];
  features: FeatureValue[];
}

// ─── GET ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { adminUser, adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  const supabase = createServerClient();

  // Fetch tiers
  const { data: tiers, error: tiersError } = await (supabase as any)
    .from('subscription_tiers')
    .select('id, key, name')
    .order('sort_order', { ascending: true });

  if (tiersError) {
    console.error('[admin/tiers] Failed to fetch subscription_tiers:', tiersError.message);
    return NextResponse.json({ error: 'Failed to load tiers', details: tiersError.message }, { status: 500 });
  }

  // ── Step 1: Fetch feature definitions (no join — direct query) ──
  const { data: featureDefs, error: featureDefsError } = await (supabase as any)
    .from('tier_features')
    .select('id, key')
    .in('key', EDITABLE_FEATURES);

  if (featureDefsError) {
    console.error('[admin/tiers] tier_features query failed:', featureDefsError.message);
    return NextResponse.json(
      { error: 'Failed to query tier_features. Does the table exist?', details: featureDefsError.message },
      { status: 500 }
    );
  }

  console.log('[admin/tiers] tier_features found:', (featureDefs || []).map((f: any) => f.key).join(', '));

  // Build feature ID → key lookup
  const featureIdToKey: Record<string, string> = {};
  for (const f of featureDefs || []) {
    featureIdToKey[f.id] = f.key;
  }

  // ── Step 2: Fetch values using the feature IDs (no join) ──
  const featureIds = Object.keys(featureIdToKey);

  let values: any[] = [];
  if (featureIds.length > 0) {
    const { data: rawValues, error: valuesError } = await (supabase as any)
      .from('tier_feature_values')
      .select('tier_id, feature_id, value')
      .in('feature_id', featureIds);

    if (valuesError) {
      console.error('[admin/tiers] tier_feature_values query failed:', valuesError.message);
      return NextResponse.json(
        { error: 'Failed to query tier_feature_values. Has migration 024 been run?', details: valuesError.message },
        { status: 500 }
      );
    }
    values = rawValues || [];
  }

  console.log('[admin/tiers] tier_feature_values rows:', values.length);

  // ── Step 3: Join in code (bulletproof) ──
  const features = values.map((v: any) => ({
    tier_id: v.tier_id,
    feature_key: featureIdToKey[v.feature_id] || 'UNKNOWN',
    value: v.value,
  }));

  // ── Step 4: Fill in any missing feature×tier combos with empty strings ──
  // This ensures the editor shows all cells (even if DB hasn't been populated)
  const existingKeys = new Set(features.map((f: any) => `${f.tier_id}:${f.feature_key}`));
  for (const tier of tiers || []) {
    for (const featureDef of featureDefs || []) {
      const comboKey = `${tier.id}:${featureDef.key}`;
      if (!existingKeys.has(comboKey)) {
        features.push({
          tier_id: tier.id,
          feature_key: featureDef.key,
          value: '',
        });
      }
    }
  }

  // Missing feature keys (in EDITABLE_FEATURES but not in tier_features)
  const missingKeys = EDITABLE_FEATURES.filter(k => !featureDefs?.some((f: any) => f.key === k));
  if (missingKeys.length > 0) {
    console.warn('[admin/tiers] Missing tier_features keys:', missingKeys.join(', '));
  }

  return NextResponse.json({ tiers: tiers || [], features });
}

// ─── PUT ──────────────────────────────────────────────────────

export async function PUT(request: NextRequest) {
  const { adminUser, adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  let body: { features: FeatureValue[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.features)) {
    return NextResponse.json(
      { error: 'Expected { features: [...] } array' },
      { status: 400 }
    );
  }

  const updates = body.features;

  // ── Validation ────────────────────────────────────────────

  const supabase = createServerClient();

  // Step 1: Get feature IDs (same bulletproof approach as GET handler)
  const { data: featureDefs } = await (supabase as any)
    .from('tier_features')
    .select('id, key')
    .in('key', EDITABLE_FEATURES);

  const featureIdToKey: Record<string, string> = {};
  for (const f of featureDefs || []) featureIdToKey[f.id] = f.key;
  const featureIds = Object.keys(featureIdToKey);

  // Step 2: Get current values using feature IDs (no inner join)
  let currentValues: any[] = [];
  if (featureIds.length > 0) {
    const { data: cv } = await (supabase as any)
      .from('tier_feature_values')
      .select('tier_id, feature_id, value')
      .in('feature_id', featureIds);
    currentValues = cv || [];
  }

  const currentLookup: Record<string, Record<string, string>> = {};
  for (const v of currentValues) {
    const key = featureIdToKey[v.feature_id];
    if (!key) continue;
    if (!currentLookup[key]) currentLookup[key] = {};
    currentLookup[key][v.tier_id] = v.value;
  }

  // Merge updates into current state for validation
  for (const u of updates) {
    if (!currentLookup[u.feature_key]) currentLookup[u.feature_key] = {};
    currentLookup[u.feature_key][u.tier_id] = String(u.value);
  }

  // Get tier IDs for ordering checks
  const { data: tiers } = await (supabase as any)
    .from('subscription_tiers')
    .select('id, key, sort_order')
    .order('sort_order', { ascending: true });

  const tierIds = tiers?.map((t: any) => t.id) || [];
  const tierKeyById: Record<string, string> = {};
  for (const t of tiers || []) tierKeyById[t.id] = t.key;

  const errors: string[] = [];

  for (const u of updates) {
    const key = u.feature_key;
    const val = parseInt(String(u.value), 10);
    const tierKey = tierKeyById[u.tier_id];

    // No negative values
    if (val < 0) {
      errors.push(`${tierKey || u.tier_id}: ${key} cannot be negative (got ${u.value})`);
    }

    // Model access must be 'haiku' or 'haiku+sonnet'
    if (key === 'model_access') {
      if (!['haiku', 'haiku+sonnet'].includes(String(u.value))) {
        errors.push(`${tierKey}: model_access must be 'haiku' or 'haiku+sonnet' (got '${u.value}')`);
      }
    }
  }

  // Cross-tier: Demo daily chat ≤ Silver ≤ Gold
  const demoId = tiers?.find((t: any) => t.key === 'demo')?.id;
  const silverId = tiers?.find((t: any) => t.key === 'silver')?.id;
  const goldId = tiers?.find((t: any) => t.key === 'gold')?.id;

  function getVal(tierId: string | undefined, feature: string): number {
    if (!tierId) return Infinity;
    const val = currentLookup[feature]?.[tierId];
    return val !== undefined ? parseInt(val, 10) : Infinity;
  }

  // For ascending features (limits): Demo ≤ Silver ≤ Gold
  const ascendingFeatures = ['ai_message_limit', 'monthly_chat_limit'];
  for (const f of ascendingFeatures) {
    const d = getVal(demoId, f);
    const s = getVal(silverId, f);
    const g = getVal(goldId, f);
    if (d !== Infinity && s !== Infinity && d > s) {
      errors.push(`Demo ${f} (${d}) exceeds Silver ${f} (${s})`);
    }
    if (s !== Infinity && g !== Infinity && s > g) {
      errors.push(`Silver ${f} (${s}) exceeds Gold ${f} (${g})`);
    }
  }

  if (errors.length > 0) {
    return NextResponse.json(
      { error: 'Validation failed', details: errors },
      { status: 422 }
    );
  }

  // ── Execute upserts ──────────────────────────────────────

  // Resolve feature_id for each feature_key
  const { data: featureRows } = await (supabase as any)
    .from('tier_features')
    .select('id, key')
    .in('key', EDITABLE_FEATURES);

  const featureIdMap: Record<string, string> = {};
  for (const f of featureRows || []) featureIdMap[f.key] = f.id;

  // Ensure model_access exists in tier_features
  if (!featureIdMap['model_access']) {
    const { data: newFeature } = await (supabase as any)
      .from('tier_features')
      .insert({
        key: 'model_access',
        label: 'Model access',
        description: 'Which models this tier can use: haiku (Claude Haiku only) or haiku+sonnet (Haiku + Sonnet for Deep Dive)',
        sort_order: 25,
      })
      .select('id, key')
      .single();
    if (newFeature) featureIdMap['model_access'] = newFeature.id;
  }

  const results: { tier: string; feature: string; value: string }[] = [];

  for (const u of updates) {
    const featureId = featureIdMap[u.feature_key];
    if (!featureId) {
      return NextResponse.json(
        { error: `Unknown feature key: ${u.feature_key}` },
        { status: 400 }
      );
    }

    const { error } = await (supabase as any)
      .from('tier_feature_values')
      .upsert(
        {
          tier_id: u.tier_id,
          feature_id: featureId,
          value: String(u.value),
        },
        { onConflict: 'tier_id, feature_id' }
      );

    if (error) {
      return NextResponse.json(
        { error: `DB error on ${u.feature_key} for tier ${u.tier_id}: ${error.message}` },
        { status: 500 }
      );
    }

    results.push({
      tier: tierKeyById[u.tier_id] || u.tier_id,
      feature: u.feature_key,
      value: String(u.value),
    });
  }

  return NextResponse.json({ success: true, updated: results });
}
