'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────

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

interface ConfigData {
  tiers: TierInfo[];
  features: FeatureValue[];
}

// Feature definitions for the editor
const FEATURE_META: Record<string, { label: string; suffix: string; type: 'number' | 'select'; options?: string[]; tiers?: string[] }> = {
  ai_message_limit: { label: 'Daily chat messages', suffix: 'msg/day', type: 'number' },
  monthly_chat_limit: { label: 'Monthly chat messages', suffix: 'msg/month', type: 'number' },
  model_access: { label: 'Model access', suffix: '', type: 'select', options: ['haiku', 'haiku+sonnet'] },
};

// Sorting from cheapest → most capable tier
const FEATURE_ORDER = ['ai_message_limit', 'monthly_chat_limit', 'model_access'];

// ─── Component ─────────────────────────────────────────────────

export function TiersEditor() {
  const [config, setConfig] = useState<ConfigData | null>(null);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fetch config on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/tiers');
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data: ConfigData = await res.json();
        setConfig(data);

        // Initialize edits from current values
        const init: Record<string, Record<string, string>> = {};
        for (const f of data.features) {
          if (!init[f.feature_key]) init[f.feature_key] = {};
          init[f.feature_key][f.tier_id] = f.value;
        }
        setEdits(init);
      } catch (e: any) {
        setError(e.message || 'Failed to load config');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Update a single value
  const handleChange = useCallback(
    (featureKey: string, tierId: string, value: string) => {
      setEdits((prev) => ({
        ...prev,
        [featureKey]: { ...(prev[featureKey] || {}), [tierId]: value },
      }));
      setSaved(false);
    },
    []
  );

  // Save
  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const updates: FeatureValue[] = [];
    for (const [featureKey, tierValues] of Object.entries(edits)) {
      for (const [tierId, value] of Object.entries(tierValues)) {
        updates.push({ tier_id: tierId, feature_key: featureKey, value });
      }
    }

    try {
      const res = await fetch('/api/admin/tiers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: updates }),
      });

      const data = await res.json();
      if (!res.ok) {
        const details = Array.isArray(data.details) ? data.details.join('; ') : data.error;
        throw new Error(details || `HTTP ${res.status}`);
      }
      setSaved(true);
    } catch (e: any) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── Loading / Error states ───────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <p className="text-gray-500">Loading tier config...</p>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <a href="/?tab=settings" className="text-blue-600 hover:underline text-sm">← Back to Settings</a>
        </div>
      </div>
    );
  }

  if (!config) return null;

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              ⚙️ Tier Config — AI Limits & Model Access
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Changes take effect immediately for all users. Use with care.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && (
              <span className="text-green-600 text-sm font-medium">
                ✓ Saved
              </span>
            )}
            {error && (
              <span className="text-red-600 text-sm">{error}</span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white dark:bg-gray-900 rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                <th className="px-4 py-3 font-medium text-gray-500">Feature</th>
                {config.tiers.map((t) => (
                  <th key={t.id} className="px-4 py-3 font-medium text-gray-500 capitalize">
                    {t.name}
                    <span className="block text-xs font-normal text-gray-400">
                      {t.key === 'demo' ? 'Free trial' : t.key === 'silver' ? 'Paid' : 'Premium'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURE_ORDER.map((featureKey) => {
                const meta = FEATURE_META[featureKey];
                if (!meta) return null;

                return (
                  <tr
                    key={featureKey}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-850"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800 dark:text-gray-200">
                        {meta.label}
                      </div>
                      <div className="text-xs text-gray-400">{meta.suffix}</div>
                    </td>
                    {config.tiers.map((tier) => {
                      // Skip if this feature doesn't apply to this tier
                      if (meta.tiers && !meta.tiers.includes(tier.key)) {
                        return (
                          <td key={tier.id} className="px-4 py-3">
                            <span className="text-gray-300 dark:text-gray-600 text-xs">
                              —
                            </span>
                          </td>
                        );
                      }

                      const val = edits[featureKey]?.[tier.id] || '';

                      if (meta.type === 'select') {
                        return (
                          <td key={tier.id} className="px-4 py-3">
                            <select
                              value={val}
                              onChange={(e) =>
                                handleChange(featureKey, tier.id, e.target.value)
                              }
                              className="px-2 py-1 border rounded text-sm dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200 w-36"
                            >
                              {meta.options?.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt === 'haiku' ? 'Haiku only' : 'Haiku + Sonnet'}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      }

                      return (
                        <td key={tier.id} className="px-4 py-3">
                          <input
                            type="number"
                            min={0}
                            value={val}
                            onChange={(e) =>
                              handleChange(featureKey, tier.id, e.target.value)
                            }
                            className="px-2 py-1 border rounded text-sm w-24 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-200"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Quick reference */}
        <div className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          <p>
            <strong>Model access:</strong> Haiku only = Chat + Deep Dive both use Claude Haiku.
            Haiku+Sonnet = Chat uses Haiku, Deep Dive uses Sonnet.
          </p>
        </div>
      </div>
    </div>
  );
}
