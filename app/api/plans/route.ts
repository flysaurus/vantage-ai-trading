// ─── GET /api/plans ─────────────────────────────────────────
// Returns subscription tiers + features matrix from DB.
// Public endpoint — anon and authenticated RLS policies allow reads.

import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';

interface TierRow {
  id: string;
  key: string;
  name: string;
  price_label: string;
  accent_color: string;
  accent_bg: string;
  accent_border: string;
  badge_text: string | null;
  badge_bg: string | null;
  cta_label: string;
  is_default: boolean;
}

interface FeatureRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
}

interface ValueRow {
  tier_id: string;
  feature_id: string;
  value: string;
}

export async function GET() {
  const supabase = createServerClient();

  const [{ data: tiers }, { data: features }, { data: values }] = await Promise.all([
    supabase.from('subscription_tiers').select('*').order('sort_order').returns<TierRow[]>(),
    supabase.from('tier_features').select('*').order('sort_order').returns<FeatureRow[]>(),
    supabase.from('tier_feature_values').select('*').returns<ValueRow[]>(),
  ]);

  if (!tiers || !features || !values) {
    return NextResponse.json(
      { error: 'Failed to load plans data' },
      { status: 500 }
    );
  }

  // Build tier-key lookup
  const tierMap = new Map(tiers.map(t => [t.id, t.key]));
  const featureValues: Record<string, Record<string, string>> = {};

  for (const v of values) {
    const tierKey = tierMap.get(v.tier_id);
    if (!tierKey) continue;
    if (!featureValues[v.feature_id]) featureValues[v.feature_id] = {};
    featureValues[v.feature_id][tierKey] = v.value;
  }

  // Assemble features with per-tier values
  const assembledFeatures = features.map(f => ({
    key: f.key,
    label: f.label,
    description: f.description,
    values: featureValues[f.id] || {},
  }));

  return NextResponse.json({
    tiers: tiers.map(t => ({
      key: t.key,
      name: t.name,
      priceLabel: t.price_label,
      accentColor: t.accent_color,
      accentBg: t.accent_bg,
      accentBorder: t.accent_border,
      badgeText: t.badge_text,
      badgeBg: t.badge_bg,
      ctaLabel: t.cta_label,
      isDefault: t.is_default,
    })),
    features: assembledFeatures,
  });
}
