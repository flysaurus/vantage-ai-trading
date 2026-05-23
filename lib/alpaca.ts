/**
 * Alpaca API client.
 * 
 * Uses HMAC-signed tokens (not cookies) for auth.
 * Replace mock implementations with real Alpaca SDK calls
 * when API keys are configured.
 */

const ALPACA_BASE = 'https://paper-api.alpaca.markets/v2';

function getAuthHeaders(): Record<string, string> {
  const keyId = process.env.ALPACA_API_KEY_ID;
  const secretKey = process.env.ALPACA_SECRET_KEY;

  if (!keyId || !secretKey) {
    throw new Error('Alpaca API keys not configured');
  }

  return {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secretKey,
    'Content-Type': 'application/json',
  };
}

export async function getAccount() {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALPACA_BASE}/account`, { headers });
  if (!res.ok) throw new Error(`Alpaca account error: ${res.statusText}`);
  return res.json();
}

export async function getPositions() {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALPACA_BASE}/positions`, { headers });
  if (!res.ok) throw new Error(`Alpaca positions error: ${res.statusText}`);
  return res.json();
}

export async function getOrders(params?: {
  status?: string;
  limit?: number;
  symbols?: string;
}) {
  const headers = getAuthHeaders();
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.symbols) query.set('symbols', params.symbols);

  const url = `${ALPACA_BASE}/orders?${query.toString()}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Alpaca orders error: ${res.statusText}`);
  return res.json();
}

export async function placeOrder(order: {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force: 'day' | 'gtc' | 'ioc' | 'fok';
  limit_price?: number;
  stop_price?: number;
  order_class?: 'simple' | 'bracket' | 'oto';
  take_profit?: { limit_price: number };
  stop_loss?: { stop_price: number };
}) {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALPACA_BASE}/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify(order),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Alpaca order error: ${err.message || res.statusText}`);
  }
  return res.json();
}

export async function cancelOrder(orderId: string) {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALPACA_BASE}/orders/${orderId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error(`Alpaca cancel error: ${res.statusText}`);
  return res.json();
}

export async function getQuote(symbol: string) {
  const headers = getAuthHeaders();
  const res = await fetch(`${ALPACA_BASE}/stocks/${symbol}/quotes/latest`, {
    headers,
  });
  if (!res.ok) throw new Error(`Alpaca quote error: ${res.statusText}`);
  return res.json();
}

export function isMarketOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();

  // Weekend check
  if (day === 0 || day === 6) return false;

  // Market hours: 9:30 AM - 4:00 PM ET = 13:30 - 20:00 UTC (standard)
  //                                 = 12:30 - 19:00 UTC (daylight)
  // Simplified: use 13:30-20:00 UTC
  const marketOpen = hours > 13 || (hours === 13 && minutes >= 30);
  const marketClose = hours > 20 || (hours === 20 && minutes > 0);

  return marketOpen && !marketClose;
}
