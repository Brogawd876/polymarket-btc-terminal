# PHASE PLAN

PHASE ID
Phase 2

PHASE OBJECTIVE
Reliably identify and stream the current and next BTC five-minute markets using Gamma API for discovery and the CLOB WebSocket for order book streaming.

BASELINE COMMIT
Current state of the main branch where the extension polls Gamma API using browser URL and the backend relies on 3-second CLOB midpoint polling.

CURRENT BEHAVIOR
- `apps/extension/src/entrypoints/content.tsx` blindly reads the browser URL slug, requests Gamma API, and passes the first market to the server.
- `apps/server/src/integrations/polymarket/adapter.ts` polls midpoint prices via `https://clob.polymarket.com/midpoint` every 3 seconds.
- No order book tracking. No discovery of the "next" market ahead of time. No retention of previous unresolved market.

TARGET BEHAVIOR
- The server independently queries Gamma API to discover the current, next, and previous unresolved markets matching the `MARKET_FAMILY` configuration.
- The server connects to the CLOB `market` WebSocket endpoint to subscribe to relevant token IDs.
- The server manages normalized order-book state (snapshots, bids, asks, price changes, tick-size changes) and drops 3-second midpoint polling entirely.
- The server broadcasts a rich `MarketState` payload containing the order book, countdown, and tracking states.
- The extension accurately displays a read-only panel with exact market window, countdown, UP/DOWN bid/ask spread, data age, and current/next statuses without requiring a private key.

TARGET FILES
- `apps/server/src/integrations/polymarket/discovery.ts` (NEW)
- `apps/server/src/integrations/polymarket/adapter.ts`
- `apps/server/src/routes/index.ts`
- `packages/shared/src/index.ts`
- `apps/extension/src/entrypoints/content.tsx`
- `apps/extension/src/components/TradingPanel.tsx`

CONNECTED FILES
- `apps/server/src/index.ts`
- `apps/extension/src/hooks/useWebSocket.ts`

CALLERS
- `apps/server/src/index.ts` calls `adapter.initialize()` and the new discovery service.
- UI components call the `useWebSocket` hook to consume market data.

CALLEES
- Gamma API `GET /events`
- CLOB `wss://ws-subscriptions-clob.polymarket.com/ws/market`

SHARED CONTRACTS
- `MarketStateSchema` in `packages/shared/src/index.ts` must be extended.
- `WsEventSchema` must accommodate rich order book structures.

ENVIRONMENT VARIABLES
- `MARKET_FAMILY` (e.g., `btc-updown-5m`) - used to discover valid markets via Gamma API.

DATABASE IMPACT
- Minimal. The market data is ephemeral and cached in memory (adapter cache). 

FRONTEND IMPACT
- High. The UI must be refactored to show deep market data (bid/ask vs mid), countdowns, and handle transitioning smoothly from current to next market states.
- Removes client-side Gamma API queries.

BACKEND IMPACT
- High. Requires a new long-running discovery task polling Gamma API periodically (e.g., every 15-30s).
- Requires a new WebSocket connection specifically for the `market` channel to consume real-time order books.

TEST IMPACT
- Need to mock CLOB WebSocket snapshots and deltas.
- Need to mock Gamma API discovery responses to test boundary transitions (current -> next).

OPERATIONS IMPACT
- Reduces unnecessary HTTP rate-limit concerns against the CLOB midpoint endpoint.
- Increases background memory usage slightly on the server to hold active order books.

CONFIRMED DEFECTS
- 3-second midpoint polling violates real-time trading requirements and misses critical tick changes.
- Relying on the browser URL for market discovery is fragile and breaks if the user switches tabs or navigates away.

ROOT CAUSES
- Previous implementation prioritized quick integration over a robust daemon architecture.

NON-ISSUES
- User WebSocket auth for fills/orders remains separate and intact.

UNVERIFIED ASSUMPTIONS
- Gamma API provides all necessary fields (tick size, min order size, resolving state) reliably for 5-minute markets without pagination hell.

DEPENDENCIES
- Gamma API structure stability.
- CLOB WebSocket subscription API compatibility.

RISKS
- Stale order books if WebSocket drops silently. Requires robust ping/pong and reconnect logic.
- Complex state management when merging deltas onto the snapshot.
