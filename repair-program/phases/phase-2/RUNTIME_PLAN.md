# Runtime Plan: Phase 2

## Execution Sequence
1. The server boots and calls `adapter.initialize()`.
2. A background `MarketDiscoveryService` spins up, polling Gamma API (e.g., every 15s).
3. The discovery service updates the adapter with the list of active token IDs (current, next, resolving).
4. The adapter connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market`.
5. The adapter sends a subscription message for the given token IDs.
6. The adapter receives a snapshot event, initializing the internal order book representation.
7. The adapter processes streaming delta events, updating the order book.
8. The server's internal WebSocket bridging loop broadcasts `MARKET_UPDATE` with the full order book state to any connected extension clients.

## Liveness & Monitoring
- **CLOB WS Heartbeats**: Implement ping/pong frames or application-level keepalives on the `ws/market` connection. If no data/ping is received within 15 seconds, disconnect and reconnect.
- **Order Book Integrity**: Check sequence IDs (if provided by Polymarket) or periodically drop state and fetch a new snapshot to ensure deltas haven't drifted.
- **Discovery Failsafes**: If Gamma API fails, log an error immediately but keep the current market active until the timestamp strictly dictates it is expired. 

## Rollback Plan
- If real-time order books fail or consume too much memory, we can revert `adapter.ts` to midpoint polling using `git checkout` to the Phase 1 state, maintaining the `packages/shared/src/index.ts` structure so the frontend does not break entirely.
