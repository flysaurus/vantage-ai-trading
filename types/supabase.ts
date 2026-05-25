// ─── Supabase Database Types ──────────────────────────────────
// Auto-generated types from the Supabase schema.
// In production, generate these with:
//   npx supabase gen types typescript --project-id <id> > types/supabase.ts
//
// For now, we define the minimal types needed for the auth + vault system.

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string | null;
          display_name: string | null;
          avatar_url: string | null;
          investor_style: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          investor_style_set_at: string | null;
          investor_style_onboarded: boolean;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          investor_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          investor_style_set_at?: string | null;
          investor_style_onboarded?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          investor_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          investor_style_set_at?: string | null;
          investor_style_onboarded?: boolean;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      vault: {
        Row: {
          id: string;
          user_id: string;
          encrypted_api_key: string;
          encrypted_secret_key: string;
          master_password_hash: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          encrypted_api_key: string;
          encrypted_secret_key: string;
          master_password_hash: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          encrypted_api_key?: string;
          encrypted_secret_key?: string;
          master_password_hash?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      chat_history: {
        Row: {
          id: string;
          user_id: string;
          role: 'user' | 'assistant' | 'system';
          message_type: 'user_message' | 'ai_response' | null;
          content: string;
          investor_style: string | null;
          related_stocks: string[] | null;
          metadata: Record<string, unknown>;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          role?: 'user' | 'assistant' | 'system';
          message_type?: 'user_message' | 'ai_response' | null;
          content: string;
          investor_style?: string | null;
          related_stocks?: string[] | null;
          metadata?: Record<string, unknown>;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: Record<string, unknown>;
      };
      trade_history: {
        Row: {
          id: string;
          user_id: string;
          alpaca_order_id: string | null;
          symbol: string;
          side: 'buy' | 'sell';
          action: 'buy' | 'sell' | null;
          type: string;
          qty: number;
          quantity: number | null;
          filled_price: number | null;
          price: number | null;
          total_value: number | null;
          commission: number | null;
          notes: string | null;
          status: string;
          bracket: Record<string, unknown> | null;
          ai_suggestion_id: string | null;
          created_at: string;
          updated_at: string | null;
          executed_at: string | null;
          filled_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          alpaca_order_id?: string | null;
          symbol: string;
          side?: 'buy' | 'sell';
          action?: 'buy' | 'sell' | null;
          type?: string;
          qty?: number;
          quantity?: number | null;
          filled_price?: number | null;
          price?: number | null;
          total_value?: number | null;
          commission?: number | null;
          notes?: string | null;
          status?: string;
          bracket?: Record<string, unknown> | null;
          ai_suggestion_id?: string | null;
          created_at?: string;
          updated_at?: string | null;
          executed_at?: string | null;
          filled_at?: string | null;
        };
        Update: Record<string, unknown>;
      };
      ai_suggestions: {
        Row: {
          id: string;
          user_id: string;
          type: 'buy' | 'sell' | 'hold' | 'rebalance' | 'insight';
          symbol: string | null;
          conviction: number | null;
          title: string;
          reason: string | null;
          metrics: Record<string, unknown>;
          status: 'pending' | 'accepted' | 'rejected' | 'expired';
          executed_trade_id: string | null;
          created_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          type: 'buy' | 'sell' | 'hold' | 'rebalance' | 'insight';
          symbol?: string | null;
          conviction?: number | null;
          title: string;
          reason?: string | null;
          metrics?: Record<string, unknown>;
          status?: 'pending' | 'accepted' | 'rejected' | 'expired';
          executed_trade_id?: string | null;
          created_at?: string;
          expires_at?: string | null;
        };
        Update: {
          status?: 'pending' | 'accepted' | 'rejected' | 'expired';
          executed_trade_id?: string | null;
        };
      };
      alerts: {
        Row: {
          id: string;
          user_id: string;
          symbol: string;
          alert_type: 'price_above' | 'price_below' | 'percent_change';
          target_value: number;
          is_active: boolean;
          triggered_at: string | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          symbol: string;
          alert_type: 'price_above' | 'price_below' | 'percent_change';
          target_value: number;
          is_active?: boolean;
          triggered_at?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          alert_type?: 'price_above' | 'price_below' | 'percent_change';
          target_value?: number;
          is_active?: boolean;
          triggered_at?: string | null;
          updated_at?: string | null;
        };
      };
      account_snapshots: {
        Row: {
          id: string;
          user_id: string;
          equity: number;
          cash: number;
          buying_power: number;
          day_pnl: number;
          total_pnl: number;
          positions: Record<string, unknown>[];
          confidence_score: number | null;
          snapshot_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          equity?: number;
          cash?: number;
          buying_power?: number;
          day_pnl?: number;
          total_pnl?: number;
          positions?: Record<string, unknown>[];
          confidence_score?: number | null;
          snapshot_at?: string;
        };
        Update: Record<string, unknown>;
      };
      watchlists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          stocks: Array<{ symbol: string; addedAt: string }>;
          is_default: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string;
          description?: string | null;
          stocks?: Array<{ symbol: string; addedAt: string }>;
          is_default?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          description?: string | null;
          stocks?: Array<{ symbol: string; addedAt: string }>;
          is_default?: boolean;
          updated_at?: string;
        };
      };
      metrics: {
        Row: {
          id: string;
          user_id: string;
          total_value: number;
          total_gain: number;
          total_return: number;
          portfolio_yield: number;
          avg_pe: number;
          concentration_risk: number;
          recorded_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          total_value: number;
          total_gain: number;
          total_return: number;
          portfolio_yield?: number;
          avg_pe?: number;
          concentration_risk?: number;
          recorded_at?: string;
          created_at?: string;
        };
        Update: Record<string, unknown>;
      };
      strategies: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          investor_style: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger' | null;
          target_allocation: Record<string, number>;
          stocks: string[];
          performance_notes: string | null;
          created_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          investor_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger' | null;
          target_allocation?: Record<string, number>;
          stocks?: string[];
          performance_notes?: string | null;
          created_at?: string;
          updated_at?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
          investor_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger' | null;
          target_allocation?: Record<string, number>;
          stocks?: string[];
          performance_notes?: string | null;
          updated_at?: string | null;
        };
      };
      market_cache: {
        Row: {
          symbol: string;
          data: Record<string, unknown>;
          cached_at: string;
          expires_at: string;
        };
        Insert: {
          symbol: string;
          data: Record<string, unknown>;
          cached_at?: string;
          expires_at: string;
        };
        Update: {
          data?: Record<string, unknown>;
          cached_at?: string;
          expires_at?: string;
        };
      };
      portfolio_analysis: {
        Row: {
          id: string;
          user_id: string;
          total_value: number | null;
          total_gain: number | null;
          total_return: number | null;
          position_count: number | null;
          selected_style: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          style_score: number | null;
          style_recommendation: 'BUY_MORE' | 'HOLD' | 'SELL' | 'REBALANCE' | null;
          style_insights: string[] | null;
          has_conflict: boolean;
          conflict_severity: 'low' | 'medium' | 'high' | null;
          conflict_alert: string | null;
          all_styles_recommendation: Record<string, string | null>;
          position_recommendations: Record<string, unknown> | null;
          analyzed_at: string;
          cached_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          total_value?: number | null;
          total_gain?: number | null;
          total_return?: number | null;
          position_count?: number | null;
          selected_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          style_score?: number | null;
          style_recommendation?: 'BUY_MORE' | 'HOLD' | 'SELL' | 'REBALANCE' | null;
          style_insights?: string[] | null;
          has_conflict?: boolean;
          conflict_severity?: 'low' | 'medium' | 'high' | null;
          conflict_alert?: string | null;
          all_styles_recommendation?: Record<string, string | null>;
          position_recommendations?: Record<string, unknown> | null;
          analyzed_at?: string;
          cached_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          total_value?: number | null;
          total_gain?: number | null;
          total_return?: number | null;
          position_count?: number | null;
          selected_style?: 'buffett' | 'lynch' | 'livermore' | 'soros' | 'munger';
          style_score?: number | null;
          style_recommendation?: 'BUY_MORE' | 'HOLD' | 'SELL' | 'REBALANCE' | null;
          style_insights?: string[] | null;
          has_conflict?: boolean;
          conflict_severity?: 'low' | 'medium' | 'high' | null;
          conflict_alert?: string | null;
          all_styles_recommendation?: Record<string, string | null>;
          position_recommendations?: Record<string, unknown> | null;
          analyzed_at?: string;
          cached_until?: string | null;
          updated_at?: string;
        };
      };
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      vault_store_keys: {
        Args: {
          p_user_id: string;
          p_api_key: string;
          p_secret_key: string;
          p_master_hash: string;
          p_encryption_key: string;
        };
        Returns: void;
      };
      vault_get_keys: {
        Args: {
          p_user_id: string;
          p_encryption_key: string;
        };
        Returns: { api_key: string; secret_key: string }[];
      };
      vault_get_password_hash: {
        Args: {
          p_user_id: string;
        };
        Returns: string;
      };
      vault_clear_keys: {
        Args: {
          p_user_id: string;
        };
        Returns: void;
      };
    };
  };
}
