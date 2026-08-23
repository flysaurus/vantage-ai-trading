'use client';
// ─── useFeatureGate — Tier-aware feature gating ──────────────
// Checks whether the current user's tier has access to a feature.
// Reads from /api/auth/me (cached in AuthContext) for user.tier,
// then fetches tier_feature_values to determine access.

import { useAuth } from '@/context/AuthContext';
import { useState, useEffect } from 'react';

type FeatureKey =
  | 'ai_insights'
  | 'alerts_watchlists'
  | 'macro_calendar'
  | 'news_feed'
  | 'paper_trading'
  | 'style_quiz'
  | 'broker_readonly'
  | 'csv_import'
  | 'live_execution'
  | 'options_futures'
  | 'totp_2fa'
  | 'tax_lot_tracking'
  | 'tax_loss_harvesting'
  | 'csv_export'
  | 'ai_message_limit';

const CACHE = new Map<string, Record<string, boolean | string>>();

export function useFeatureGate(featureKey: FeatureKey): {
  hasAccess: boolean;
  value: string | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const tier = (user as any)?.tier ?? 'demo';
  const [hasAccess, setHasAccess] = useState(true); // optimistic default
  const [value, setValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchFeatures() {
      const cacheKey = `features_${tier}`;

      if (!CACHE.has(cacheKey)) {
        try {
          const res = await fetch('/api/plans');
          if (!res.ok) throw new Error('Failed');
          const data = await res.json();
          // Build a map: feature_key → value per tier
          const map: Record<string, string> = {};
          for (const f of data.features || []) {
            map[f.key] = f.values[tier] ?? 'false';
          }
          CACHE.set(cacheKey, map);
        } catch {
          // On failure, fall back to all access
          return;
        }
      }

      if (cancelled) return;

      const map = CACHE.get(cacheKey) ?? {};
      const v = map[featureKey] ?? 'false';

      // 'true', a number string, or any non-'false' value = access
      const access = v !== 'false' && v !== '0';
      if (!cancelled) {
        setHasAccess(access);
        setValue(String(v));
        setLoading(false);
      }
    }

    fetchFeatures();
    return () => { cancelled = true; };
  }, [tier, featureKey]);

  return { hasAccess, value, loading };
}
