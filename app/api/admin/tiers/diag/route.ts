// ─── Tier Config Diagnostic Endpoint ─────────────────────────────
// GET /api/admin/tiers/diag — dumps raw tier_features + tier_feature_values
// Admin-only. Temporary — remove after debugging.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin-check';
import { createServerClient } from '@/lib/supabase';

const EDITABLE_FEATURES = [
  'ai_message_limit', 'monthly_chat_limit', 'model_access',
];

export async function GET(request: NextRequest) {
  const { adminUser, adminError } = await requireAdmin(request);
  if (adminError) return adminError;

  const supabase = createServerClient();

  // Raw tier_features
  const { data: allFeatures, error: feErr } = await (supabase as any)
    .from('tier_features')
    .select('id, key, label')
    .order('sort_order');
  const featureError = feErr ? feErr.message : null;

  // Raw tier_feature_values
  const { data: allValues, error: valErr } = await (supabase as any)
    .from('tier_feature_values')
    .select('tier_id, feature_id, value');
  const valuesError = valErr ? valErr.message : null;

  // Which EDITABLE_FEATURES are in tier_features
  const foundKeys = (allFeatures || []).map((f: any) => f.key);
  const missingKeys = EDITABLE_FEATURES.filter(k => !foundKeys.includes(k));

  // Which tier_feature_values match editable features
  const editableFeatureIds = new Set(
    (allFeatures || []).filter((f: any) => EDITABLE_FEATURES.includes(f.key)).map((f: any) => f.id)
  );
  const matchingValues = (allValues || []).filter((v: any) => editableFeatureIds.has(v.feature_id));

  return NextResponse.json({
    featureError,
    valuesError,
    tier_features_count: allFeatures?.length || 0,
    tier_feature_values_count: allValues?.length || 0,
    found_editable_keys: foundKeys.filter((k: string) => EDITABLE_FEATURES.includes(k)),
    missing_keys: missingKeys,
    matching_values_count: matchingValues.length,
    tier_features: allFeatures,
    tier_feature_values: allValues,
    matching_values: matchingValues,
  });
}
