// ─── Broker Engine Types ─────────────────────────────────────
// Unified trading interface used by PortfolioContext.
// All broker adapters (DemoBroker, SnapTradeBroker, etc.) implement BrokerEngine.
//
// Types are now defined in ./types.ts (single source of truth).
// This file re-exports them for backward compatibility.
// New code should import directly from './types'.

export type {
  OrderSide,
  OrderType,
  OrderStatus,
  TimeInForce,
  OrderRequest,
  OrderResult,
  BasketOrderRequest,
  BasketOrderResult,
  BrokerPosition,
  BrokerAccountSummary,
  BrokerOrder,
  BrokerBasketOrder,
  BrokerMeta,
  BrokerEngine,
  DemoStateInternal,
} from './types';
