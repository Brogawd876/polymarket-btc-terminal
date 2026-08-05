# Implementation Assignments

## Cell 1: Shared Data & Backend Setup
**Files**: `packages/shared/src/index.ts`
**Task**: Extend `MarketStateSchema` to support Bids/Asks arrays, `startTime`, `endTime`, `tickSize`, `minOrderSize`, `isNext`, and `isUnresolved`. Export the schemas.

## Cell 2: Server Discovery Service
**Files**: `apps/server/src/integrations/polymarket/discovery.ts`, `apps/server/src/index.ts`
**Task**: Implement polling (e.g., every 15s) to the Gamma API filtering by `MARKET_FAMILY`. Locate the active, next (60s prefetch), and unresolved markets. Provide a mechanism for the adapter to read this state.

## Cell 3: CLOB WebSocket Streaming
**Files**: `apps/server/src/integrations/polymarket/adapter.ts`
**Task**: Replace midpoint polling with a WebSocket connection to the CLOB `market` channel. Connect to `wss://ws-subscriptions-clob.polymarket.com/ws/market`. Subscribe to tokens derived from the discovery service. Handle order book snapshots and continuously apply deltas. Maintain normalized state.

## Cell 4: WebSocket Bridging
**Files**: `apps/server/src/routes/index.ts`
**Task**: Update the websocket bridging so that it streams the rich market state arrays up to the client continuously or whenever a delta occurs.

## Cell 5: Frontend Refactoring
**Files**: `apps/extension/src/entrypoints/content.tsx`, `apps/extension/src/components/TradingPanel.tsx`
**Task**: Remove Gamma API logic from the frontend. Display the exact market window, countdown, Top UP bid/ask, Top DOWN bid/ask, data age, and current/next state.
