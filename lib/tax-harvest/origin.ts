// ═══════════════════════════════════════════════════════════════
// lib/tax-harvest/origin.ts
// ═══════════════════════════════════════════════════════════════
// Entry-origin plumbing for the Tax Loss Harvesting surface, plus the
// one-shot "you cancelled the disclosure" flash notice.
//
// Sellers can reach TLH from three places (Invest, Insights, Strategies).
// Each entry link carries `?from=<origin>` so the TLH page can (a) show the
// right back label and (b) route Cancel back to where the user came from.
// If the user bails on the blocking disclosure, we leave a one-shot flash
// notice in sessionStorage: the destination screen consumes it once and
// clears it.
//
// Everything here is SSR-safe and never throws.
// ═══════════════════════════════════════════════════════════════

import { TLH_DISCLOSURE_CANCEL_NOTICE } from './disclosure';

export type TlhOrigin = 'invest' | 'insights' | 'strategies';

/** Canonical TLH setup path. */
export const TLH_PATH = '/strategies/setup/tax-harvesting';

/** Human label per origin (for back buttons / breadcrumbs). */
export const TLH_ORIGIN_LABELS: Record<TlhOrigin, string> = {
  invest: 'Invest',
  insights: 'Insights',
  strategies: 'Strategies',
};

/** sessionStorage key for the cross-screen flash notice. */
export const TLH_FLASH_KEY = 'vantage:flash-notice';

const TLH_ORIGINS: readonly TlhOrigin[] = ['invest', 'insights', 'strategies'];

/** TLH entry link for a given origin: `/strategies/setup/tax-harvesting?from=<origin>`. */
export function tlhEntryPath(origin: TlhOrigin): string {
  return `${TLH_PATH}?from=${origin}`;
}

/** Validate a raw `?from=` value. Junk (or missing) → null. */
export function parseTlhOrigin(value: string | null | undefined): TlhOrigin | null {
  if (!value) return null;
  return (TLH_ORIGINS as readonly string[]).includes(value) ? (value as TlhOrigin) : null;
}

/** Where Cancel / back should return the user for a given origin. */
export function tlhOriginPath(origin: TlhOrigin): string {
  switch (origin) {
    case 'invest':
      return '/?tab=invest';
    case 'insights':
      return '/?tab=insights';
    case 'strategies':
      return '/strategies';
  }
}

interface TlhFlashPayload {
  kind: 'tlh-disclosure';
  origin: TlhOrigin;
  text: string;
}

/** SSR guard: no window → no storage. */
function sessionAvailable(): boolean {
  return typeof window !== 'undefined' && typeof sessionStorage !== 'undefined';
}

/** Leave the "disclosure required" flash for the origin screen to pick up. */
export function setTlhCancelNotice(origin: TlhOrigin): void {
  if (!sessionAvailable()) return;
  const payload: TlhFlashPayload = {
    kind: 'tlh-disclosure',
    origin,
    text: TLH_DISCLOSURE_CANCEL_NOTICE,
  };
  try {
    sessionStorage.setItem(TLH_FLASH_KEY, JSON.stringify(payload));
  } catch {
    // Non-fatal — the notice is best-effort.
  }
}

/**
 * Read AND clear the TLH cancel flash (one-shot). Returns null when there is
 * nothing stored, when the payload is malformed, or when it belongs to a
 * different notice kind. Never throws.
 */
export function consumeTlhCancelNotice(): { text: string; origin: TlhOrigin } | null {
  if (!sessionAvailable()) return null;
  try {
    const raw = sessionStorage.getItem(TLH_FLASH_KEY);
    if (!raw) return null;
    // Clear first so a re-entrant read can't double-deliver the notice.
    sessionStorage.removeItem(TLH_FLASH_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const payload = parsed as Partial<TlhFlashPayload>;
    if (payload.kind !== 'tlh-disclosure') return null;
    const origin = parseTlhOrigin(payload.origin);
    if (!origin) return null;
    const text =
      typeof payload.text === 'string' ? payload.text : TLH_DISCLOSURE_CANCEL_NOTICE;
    return { text, origin };
  } catch {
    return null;
  }
}
