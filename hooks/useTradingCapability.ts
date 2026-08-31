'use client';

import { useMemo } from 'react';
import { useAccounts } from '@/context/AccountContext';
import {
  deriveTradingCapability,
  isReadOnlyCapability,
  type TradingCapability,
} from '@/lib/broker/trading-capability';

export interface TradingCapabilityState {
  capability: TradingCapability;
  isReadOnly: boolean;
  /** Broker display name for read-only messaging (null for demo/unknown). */
  brokerDisplayName: string | null;
}

/**
 * Shared hook: derive the active account's trading capability from account
 * metadata. Replaces the ~8 duplicated `!isDemo && !tradingEnabled` inline
 * checks with one authoritative source.
 */
export function useTradingCapability(): TradingCapabilityState {
  const { activeAccount } = useAccounts();

  return useMemo<TradingCapabilityState>(() => {
    const isDemo = activeAccount?.isDemo ?? false;
    const tradingEnabled = activeAccount?.tradingEnabled ?? false;
    const capability = deriveTradingCapability({ isDemo, tradingEnabled });
    return {
      capability,
      isReadOnly: isReadOnlyCapability(capability),
      brokerDisplayName: activeAccount?.name ?? activeAccount?.broker ?? null,
    };
  }, [activeAccount]);
}
