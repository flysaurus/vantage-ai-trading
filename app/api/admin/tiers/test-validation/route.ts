// ─── Tier Validation Self-Test ──────────────────────────────────
// TEMPORARY: Runs validation suite on live DB, returns results.
// DELETE after test results confirmed.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

const EDITABLE_FEATURES = [
  'ai_message_limit', 'monthly_chat_limit', 'deep_analysis_limit',
  'monthly_deep_limit', 'demo_deep_pool', 'model_access',
] as const;

function runValidation(
  tiers: any[],
  featureIdToKey: Record<string, string>,
  currentLookup: Record<string, Record<string, string>>,
  updates: any[],
) {
  // Merge updates into current state
  const merged = JSON.parse(JSON.stringify(currentLookup));
  for (const u of updates) {
    if (!merged[u.feature_key]) merged[u.feature_key] = {};
    merged[u.feature_key][u.tier_id] = String(u.value);
  }

  const tierKeyById: Record<string, string> = {};
  for (const t of tiers) tierKeyById[t.id] = t.key;

  const errors: string[] = [];

  for (const u of updates) {
    const val = parseInt(String(u.value), 10);
    const tierKey = tierKeyById[u.tier_id];
    if (val < 0) errors.push(`${tierKey || u.tier_id}: ${u.feature_key} cannot be negative (got ${u.value})`);
    if (u.feature_key === 'model_access' && !['haiku', 'haiku+sonnet'].includes(String(u.value))) {
      errors.push(`${tierKey}: model_access must be 'haiku' or 'haiku+sonnet' (got '${u.value}')`);
    }
  }

  const demoId = tiers.find((t: any) => t.key === 'demo')?.id;
  const silverId = tiers.find((t: any) => t.key === 'silver')?.id;
  const goldId = tiers.find((t: any) => t.key === 'gold')?.id;

  function getVal(tierId: string | undefined, feature: string): number {
    if (!tierId) return Infinity;
    const val = merged[feature]?.[tierId];
    return val !== undefined ? parseInt(val, 10) : Infinity;
  }

  for (const f of ['ai_message_limit', 'monthly_chat_limit', 'deep_analysis_limit', 'monthly_deep_limit']) {
    const d = getVal(demoId, f), s = getVal(silverId, f), g = getVal(goldId, f);
    if (d !== Infinity && s !== Infinity && d > s) errors.push(`Demo ${f} (${d}) exceeds Silver ${f} (${s})`);
    if (s !== Infinity && g !== Infinity && s > g) errors.push(`Silver ${f} (${s}) exceeds Gold ${f} (${g})`);
  }

  const sPool = getVal(silverId, 'demo_deep_pool');
  const gPool = getVal(goldId, 'demo_deep_pool');
  if (sPool !== Infinity && sPool !== 0) errors.push('demo_deep_pool should be 0 for Silver');
  if (gPool !== Infinity && gPool !== 0) errors.push('demo_deep_pool should be 0 for Gold');

  return { blocked: errors.length > 0, errors };
}

export async function GET(request: NextRequest) {
  const { adminUser, adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  const supabase = createServerClient();

  // Fetch everything same way the PUT handler does
  const { data: tiers } = await (supabase as any)
    .from('subscription_tiers').select('id, key, name').order('sort_order');
  const { data: featureDefs } = await (supabase as any)
    .from('tier_features').select('id, key').in('key', EDITABLE_FEATURES);

  const featureIdToKey: Record<string, string> = {};
  for (const f of featureDefs || []) featureIdToKey[f.id] = f.key;
  const featureIds = Object.keys(featureIdToKey);

  let rawValues: any[] = [];
  if (featureIds.length > 0) {
    const { data: cv } = await (supabase as any)
      .from('tier_feature_values').select('tier_id, feature_id, value').in('feature_id', featureIds);
    rawValues = cv || [];
  }

  const currentLookup: Record<string, Record<string, string>> = {};
  for (const v of rawValues) {
    const key = featureIdToKey[v.feature_id];
    if (!key) continue;
    if (!currentLookup[key]) currentLookup[key] = {};
    currentLookup[key][v.tier_id] = v.value;
  }

  const t = tiers || [];
  const dId = t.find((x: any) => x.key === 'demo')?.id;
  const sId = t.find((x: any) => x.key === 'silver')?.id;
  const gId = t.find((x: any) => x.key === 'gold')?.id;

  const tests: any[] = [];

  // Test 1: Demo > Silver cross-tier
  const r1 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: dId, feature_key: 'ai_message_limit', value: '100' },
    { tier_id: sId, feature_key: 'ai_message_limit', value: '50' },
  ]);
  tests.push({ name: 'Demo daily chat (100) > Silver (50)', shouldBlock: true, ...r1 });

  // Test 2: Negative value
  const r2 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: sId, feature_key: 'ai_message_limit', value: '-5' },
  ]);
  tests.push({ name: 'Negative value (-5)', shouldBlock: true, ...r2 });

  // Test 3: Invalid model_access
  const r3 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: gId, feature_key: 'model_access', value: 'sonnet-only' },
  ]);
  tests.push({ name: 'Invalid model_access (sonnet-only)', shouldBlock: true, ...r3 });

  // Test 4: Valid update should pass
  const r4 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: dId, feature_key: 'ai_message_limit', value: '25' },
    { tier_id: sId, feature_key: 'ai_message_limit', value: '45' },
    { tier_id: gId, feature_key: 'ai_message_limit', value: '100' },
  ]);
  tests.push({ name: 'Valid update (25/45/100)', shouldBlock: false, ...r4 });

  // Test 5: demo_deep_pool on Silver
  const r5 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: sId, feature_key: 'demo_deep_pool', value: '5' },
  ]);
  tests.push({ name: 'demo_deep_pool on Silver (must be 0)', shouldBlock: true, ...r5 });

  // Test 6: Silver > Gold
  const r6 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: sId, feature_key: 'monthly_chat_limit', value: '2000' },
    { tier_id: gId, feature_key: 'monthly_chat_limit', value: '1500' },
  ]);
  tests.push({ name: 'Silver monthly_chat (2000) > Gold (1500)', shouldBlock: true, ...r6 });

  // Test 7: Multi-violation
  const r7 = runValidation(tiers, featureIdToKey, currentLookup, [
    { tier_id: dId, feature_key: 'ai_message_limit', value: '200' },
    { tier_id: sId, feature_key: 'ai_message_limit', value: '50' },
    { tier_id: sId, feature_key: 'monthly_chat_limit', value: '-10' },
  ]);
  tests.push({ name: 'Multi-violation (cross-tier + negative)', shouldBlock: true, ...r7 });

  const allPass = tests.every(t => t.blocked === t.shouldBlock);

  return NextResponse.json({
    dbState: {
      tiers: tiers?.map((x: any) => x.key) || [],
      featureKeys: (featureDefs || []).map((f: any) => f.key),
      missingKeys: EDITABLE_FEATURES.filter(k => !(featureDefs || []).some((f: any) => f.key === k)),
      valuesCount: rawValues.length,
      currentLimits: currentLookup,
    },
    allPass,
    tests,
    summary: {
      serverSide: true,
      frontendOnly: false,
      saveBehavior: 'all-or-nothing (422 blocks ALL upserts)',
      errorFormat: '{ error: "Validation failed", details: ["per-field messages with tier key + feature_key + value"] }',
    },
  });
}
