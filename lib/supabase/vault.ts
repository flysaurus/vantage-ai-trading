// ─── Vault Operations (encrypted secrets) ────────────────────
const API_BASE = '/api/db/vault';

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string>) };
  return fetch(path, { ...init, headers, credentials: 'include' as RequestCredentials });
}

/** Save an encrypted secret to the vault */
export async function saveSecret(userId: string, keyName: string, value: string): Promise<boolean> {
  const res = await apiFetch(`${API_BASE}/save`, { method: 'POST', body: JSON.stringify({ userId, keyName, value }) });
  return res.ok;
}

/** Retrieve and decrypt a secret from the vault */
export async function getSecret(userId: string, keyName: string): Promise<string | null> {
  const res = await apiFetch(`${API_BASE}/get?userId=${encodeURIComponent(userId)}&keyName=${encodeURIComponent(keyName)}`);
  if (res.status === 404) return null;
  if (!res.ok) { console.warn('[vault] get failed:', res.status); return null; }
  return (await res.json()).value || null;
}
