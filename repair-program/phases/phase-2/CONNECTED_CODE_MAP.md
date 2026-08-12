# Connected Code Map: Phase 2

## Entry Points
- `apps/server/src/index.ts`: Initializes the server and starts background services. Will need to boot the new Market Discovery service.
- `apps/extension/src/entrypoints/content.tsx`: Injects the app into Polymarket pages. Needs its Gamma API fetch logic removed, delegating purely to the backend websocket.

## Integrations
- `apps/server/src/integrations/polymarket/adapter.ts`: Currently handles placing orders and naive 3-second polling. Will be overhauled to manage CLOB market WebSocket connections (`wss://ws-subscriptions-clob.polymarket.com/ws/market`).
- `apps/server/src/integrations/polymarket/discovery.ts` (NEW): Will query Gamma API to reliably track current, next (prefetch at least 60s ahead), and previous unresolved markets based on `.env` configuration (`MARKET_FAMILY`).

## WebSockets / IPC
- `apps/server/src/routes/index.ts`: Handles WS connections. Broadcasts `MARKET_UPDATE` with order book state instead of just midpoint prices.
- `apps/extension/src/hooks/useWebSocket.ts` (implicit via UI): Must receive richer `MARKET_UPDATE` payloads and handle state properly.

## Shared Data Models
- `packages/shared/src/index.ts`: `MarketState` schema must be enriched with order book arrays (bids/asks), timestamps, tick size, and flags for current vs next market tracking.

## UI Components
- `apps/extension/src/components/TradingPanel.tsx`: Displays the active market data. Must be updated to render countdown, top bids/asks, order book depths, data age, and current/next statuses.
