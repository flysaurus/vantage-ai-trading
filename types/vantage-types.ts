// ─── Vantage Types — Manual overrides for application-level types ──
// These types extend or override the auto-generated supabase.ts types.
// Do NOT edit types/supabase.ts directly — it's generated from the DB schema.

// ── Broker connection ─────────────────────────────────────

export type ConnectionType = 'snaptrade' | 'alpaca' | 'tastytrade';

export type ConnectionStatus = 'pending' | 'syncing' | 'connected' | 'failed';

export interface BrokerConnection {
  id: string;
  user_id: string;
  connection_type: ConnectionType;
  encrypted_api_key: string | null;
  encrypted_secret: string | null;
  status: ConnectionStatus;
  trading_enabled: boolean;
  snaptrade_broker_id: string | null;
  sync_started_at: string | null;
  sync_completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

// Individual broker IDs available through SnapTrade
export type SnaptradeBrokerId = 'fidelity' | 'robinhood' | 'schwab' | 'vanguard' | 'etrade' | 'tdameritrade' | 'webull' | 'coinbase';

// ── User ──────────────────────────────────────────────────

export interface VantageUser {
  id?: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name?: string;
  investor_style: string | null;
  risk_tolerance: string | null;
  investor_style_onboarded: boolean;
  investor_style_set_at: string | null;
  tier: 'demo' | 'silver' | 'gold';
  demo_start_at: string | null;
  demo_expires_at: string | null;
  first_open: string | null;
  last_login: string | null;
  portfolio_mode?: string;
  connection_type: ConnectionType | null;
  connection_status: ConnectionStatus | null;
  connection_initiated_at: string | null;
  last_login_at: string | null;
  tier_upgraded_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DemoStatus {
  daysRemaining: number;
  isExpired: boolean;
  showWarning: boolean;
  percentUsed: number;
}

export type AppState =
  | 'loading'
  | 'onboarding'
  | 'needs-quiz'
  | 'needs-profile'
  | 'broker-selection'
  | 'demo-counter'
  | 'connection-options'
  | 'connection-loading'
  | 'demo-expired'
  | 'authenticated';
