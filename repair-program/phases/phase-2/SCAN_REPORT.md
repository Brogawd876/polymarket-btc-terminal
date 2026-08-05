# Phase 2 Scan Report

## Overview
Phase 2 focuses on reliable market discovery via Gamma API and real-time streaming of order book data via the CLOB WebSocket endpoint. The current implementation relies on the extension content script polling the Gamma API using the active browser URL slug and naively taking the first market. Furthermore, the server fetches midpoint prices every 3 seconds instead of utilizing real-time WebSocket order book snapshots and deltas.

## Findings
1. **Market Discovery (Gamma API)**:
   - Found in `apps/extension/src/entrypoints/content.tsx`.
   - Naive discovery: extracts slug from `window.location.pathname`, fetches `https://gamma-api.polymarket.com/events?slug=${slug}`.
   - Blind extraction: `data[0].markets[0]`. No validation of timestamps, tick size, accepting-orders state, etc.
   - Should be moved to the backend to ensure the daemon can track "current", "next", and "previous unresolved" independently of the frontend URL state.

2. **Order Book Streaming (CLOB WebSocket)**:
   - Found in `apps/server/src/integrations/polymarket/adapter.ts`.
   - Current logic uses `setInterval` polling `https://clob.polymarket.com/midpoint?token_id=${yesTokenId}` every 3 seconds.
   - Requirement strictly prohibits 3-second midpoint polling as the principal source.
   - The server must establish a connection to `wss://ws-subscriptions-clob.polymarket.com/ws/market` to subscribe to token IDs.

3. **Shared Contracts (Data Models)**:
   - Found in `packages/shared/src/index.ts`.
   - `MarketState` currently only tracks `yesPrice`, `noPrice`, and `status`.
   - Needs to be expanded to include bids, asks, `startTime`, `endTime`, `tickSize`, `minOrderSize`, `isNext`, `isUnresolved`.

4. **Frontend Expectations**:
   - `apps/extension/src/components/TradingPanel.tsx` currently displays basic `yesPrice` and `noPrice`.
   - Needs to display a read-only panel showing exact market window, countdown, UP/DOWN bid and ask, data age, and current/next status.
