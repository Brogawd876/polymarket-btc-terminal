# Test Plan: Phase 2

## Functional Testing
1. **Market Discovery**: 
   - Verify the server successfully pulls the correct 5-minute market based on `MARKET_FAMILY`.
   - Verify that 60 seconds before market boundary, the server identifies and prepares the *next* market.
   - Verify that previous markets stuck in a resolving state are retained as `isUnresolved`.
2. **Order Book Processing**:
   - Verify the backend successfully establishes `ws/market` connection.
   - Verify snapshot parsing sets the baseline order book.
   - Verify deltas correctly insert, update, or remove price levels.
   - Verify detection of stale data (e.g., if no delta received in 10s or if WS connection closes).
3. **Frontend UI**:
   - Verify read-only panel displays correct start/end time countdowns.
   - Verify bid/ask is accurately updated (not derived from a midpoint calculation).
   - Verify age of data resets instantly when WS payloads arrive.

## Negative Tests
1. **Gamma API Outage**:
   - Simulate a failed Gamma API request; server should keep trying without crashing and retain current market state until expired.
2. **WebSocket Disconnect**:
   - Force close the CLOB WebSocket connection. The server must automatically reconnect, request a new snapshot, and resume delta processing.
3. **Invalid Event Payload**:
   - Feed the WebSocket an invalid delta (e.g., mismatched seq ID). The server should log the error and force a resubscribe/snapshot.

## Regression Tests
- Ensure `adapter.placeOrder` still functions correctly using the API.
- Ensure the separate `ws/user` channel is not negatively impacted by the addition of the `ws/market` connection.
