# Dependency Map: Phase 2

## Internal Dependencies
- `packages/shared`: Defines schemas for WS payloads (`MARKET_UPDATE`) and domain types (`MarketState`). Upstream components rely on these Zod definitions for runtime validation.
- `apps/server/src/integrations/polymarket/adapter.ts` -> `discovery.ts`: The adapter relies on discovery to know which tokens to subscribe to on the CLOB WS.
- `apps/server/src/routes/index.ts` -> `adapter.ts`: The WebSocket endpoint pulls active market state from the adapter to broadcast to the extension.

## External Dependencies
- **Gamma API**: (e.g., `https://gamma-api.polymarket.com/events`) Used for market discovery, start/end timestamps, outcome validation, tick size, and token mapping.
- **Polymarket CLOB WebSocket**: (`wss://ws-subscriptions-clob.polymarket.com/ws/market`) Required for consuming order book snapshots and deltas.
- **WebSocket (ws)**: The underlying protocol for internal server-to-extension communication and server-to-CLOB streaming.
- **Zod**: Required for extending schema validations for the rich market state data.
