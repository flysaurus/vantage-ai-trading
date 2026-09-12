// ═══════════════════════════════════════════════════════════════
// lib/tax-harvest/disclosure.ts
// ═══════════════════════════════════════════════════════════════
// Versioned, per-account acceptance of the Tax Loss Harvesting
// disclosure gate.
//
// The gate is shown before the TLH surface can be used and can only be
// cleared by an explicit acceptance. Acceptance is remembered per
// account (not globally) so switching accounts re-surfaces the gate for
// an account whose disclosure was never accepted.
//
// Bumping the COPY means bumping TLH_DISCLOSURE_VERSION. Because
// isDisclosureAccepted() compares the stored record's version against
// the current constant, bumping the version invalidates every stored
// record and re-fires the gate — no migration step required.
//
// Storage: ONE localStorage key holding a JSON map of
//   { [accountId]: TaxHarvestDisclosureRecord }
// All storage access is SSR-safe and best-effort: quota / parse / access
// errors are swallowed, and a missing window degrades to "not accepted".
// ═══════════════════════════════════════════════════════════════

/** Bump when the disclosure copy changes → every stored acceptance re-fires. */
export const TLH_DISCLOSURE_VERSION = 'v1';

/** The single localStorage key holding the per-account acceptance map. */
export const TLH_STORAGE_KEY = 'vantage:tlh-disclosure:v1';

export const TLH_DISCLOSURE_TITLE = 'Before you continue';

export const TLH_DISCLOSURE_PARAGRAPHS: string[] = [
  'Vantage is not a tax advisor. This page is an estimate, not tax advice.',
  'Wash-sale warnings reflect this connected account only. If you hold or trade the same security in another account, your wash-sale outcome may differ — verify across all your accounts.',
  'You are responsible for your own tax positions and for confirming results with a qualified tax professional.',
];

export const TLH_DISCLOSURE_ACCEPT_LABEL = 'Accept and continue';
export const TLH_DISCLOSURE_CANCEL_LABEL = 'Cancel';

export const TLH_DISCLOSURE_BANNER_TEXT =
  'Estimates are illustrative, not tax advice. Wash-sale checks cover this account only — verify across all your accounts.';

export const TLH_DISCLOSURE_CANCEL_NOTICE =
  'Tax Loss Harvesting requires accepting the disclosure to continue.';

export interface TaxHarvestDisclosureRecord {
  accountId: string;
  version: string;
  acceptedAt: string;
}

type DisclosureMap = Record<string, TaxHarvestDisclosureRecord>;

/** SSR guard: no window → no storage. */
function storageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

/** Read + validate the stored map. Any problem degrades to an empty map. */
function readMap(): DisclosureMap {
  if (!storageAvailable()) return {};
  try {
    const raw = localStorage.getItem(TLH_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: DisclosureMap = {};
    for (const [accountId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        value &&
        typeof value === 'object' &&
        typeof (value as TaxHarvestDisclosureRecord).accountId === 'string' &&
        typeof (value as TaxHarvestDisclosureRecord).version === 'string' &&
        typeof (value as TaxHarvestDisclosureRecord).acceptedAt === 'string'
      ) {
        out[accountId] = value as TaxHarvestDisclosureRecord;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeMap(map: DisclosureMap): void {
  if (!storageAvailable()) return;
  try {
    localStorage.setItem(TLH_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded / serialization failure — non-fatal. The gate simply
    // re-fires next time; we never surface storage errors to the UI.
  }
}

/** The stored record for an account, or null when none exists. */
export function getDisclosureRecord(accountId: string): TaxHarvestDisclosureRecord | null {
  if (!accountId) return null;
  return readMap()[accountId] ?? null;
}

/**
 * TRUE only when a record exists for this account AND its version matches
 * the current TLH_DISCLOSURE_VERSION. A version bump invalidates everything.
 */
export function isDisclosureAccepted(accountId: string): boolean {
  const record = getDisclosureRecord(accountId);
  return record !== null && record.version === TLH_DISCLOSURE_VERSION;
}

/** Store — and return — an acceptance for this account at the current version. */
export function acceptDisclosure(accountId: string): TaxHarvestDisclosureRecord {
  const record: TaxHarvestDisclosureRecord = {
    accountId,
    version: TLH_DISCLOSURE_VERSION,
    acceptedAt: new Date().toISOString(),
  };
  const map = readMap();
  map[accountId] = record;
  writeMap(map);
  return record;
}

/** Remove one account's acceptance; other accounts are untouched. */
export function clearDisclosure(accountId: string): void {
  const map = readMap();
  if (!Object.prototype.hasOwnProperty.call(map, accountId)) return;
  delete map[accountId];
  writeMap(map);
}
