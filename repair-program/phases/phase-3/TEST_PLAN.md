# Test Plan

## Negative Tests
1. **Outcome-token Price Mislabelling**:
   - Ensure the BTC price UI element (`BTC: {price}`) is NOT updated when an outcome token's price changes on the CLOB.
2. **Stale Chainlink Blocks Actions**:
   - Artificially freeze the Chainlink RTDS data stream (or manipulate `data_age`).
   - Attempt to execute a `PLACE_ORDER` via the UI.
   - Assert that the server rejects the order with a stale data error and no order is sent to Polymarket.
3. **Disconnect UI State**:
   - Simulate a disconnection of the RTDS websocket in `rtds.ts`.
   - Ensure the frontend receives a status update (or detects lack of heartbeat/updates) and changes the UI to a disabled/disconnected state.
   - Reconnect the stream and assert the UI returns to normal functionality.

## Regression Tests
- Placing orders when data is fresh should continue to succeed without errors.
- Subscription logic for the CLOB (handled by the adapter) should not be broken by the replacement of the `rtds.ts` topic.

## Execution
- Use Playwright/Vitest for E2E tests simulating the WebSocket connection and validating UI state changes.
