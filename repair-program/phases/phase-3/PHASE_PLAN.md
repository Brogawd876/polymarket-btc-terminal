PHASE ID
Phase 3

PHASE OBJECTIVE
Implement the actual BTC/USD Chainlink reference-price stream.
Required implementation:
- Connect to correct Polymarket RTDS endpoint.
- Subscribe to the correct Chainlink topic and BTC/USD filters.
- Maintain subscription and heartbeat, handling reconnects and resubscribes.
- Track metrics: Source timestamp, receive timestamp, data age, price to beat, current value, difference, leading direction.
- Implement Stale reference lock to block configured actions if data is stale.
- Extend `packages/shared/src/index.ts` to transmit this reference price data correctly to the client.

BASELINE COMMIT
Current state

CURRENT BEHAVIOR
`rtds.ts` connects to CLOB market websockets and forwards outcome-token prices as `RTDS_UPDATE`. The frontend mistakenly displays these token prices as the BTC price. There is no staleness checking.

TARGET BEHAVIOR
`rtds.ts` will connect to the proper Chainlink RTDS endpoint for BTC/USD reference prices. It will track timestamps, data age, and current value. If data is stale, a stale reference lock will block configured actions (e.g. trading). The frontend will accurately display the actual BTC price, not outcome-tokens. Disconnections should notify the frontend to adjust UI state.

TARGET FILES
- `apps/server/src/integrations/polymarket/rtds.ts`
- `packages/shared/src/index.ts`
- `apps/server/src/routes/index.ts`

CONNECTED FILES
- `apps/extension/src/hooks/useWebSocket.ts`
- `apps/extension/src/components/App.tsx`

CALLERS
- Server initialization calling `startRtds()`
- `routes/index.ts` checking stale lock before placing order

CALLEES
- Broadcasts `RTDS_UPDATE` and possibly `RTDS_STATUS` to connected frontend clients.

SHARED CONTRACTS
- `WsEventSchema` in `@polymarket-btc/shared/src/index.ts`

ENVIRONMENT VARIABLES
- (Optional) `CHAINLINK_RTDS_URL` for testing/overrides.

DATABASE IMPACT
None

FRONTEND IMPACT
Will correctly display BTC reference price instead of token prices. Will update UI when disconnected or data is stale.

BACKEND IMPACT
Will track metrics and maintain the correct subscription. Will implement a stale data lock to block `PLACE_ORDER`.

TEST IMPACT
New negative tests required to verify stale data blocks actions and UI restores state upon reconnect.

OPERATIONS IMPACT
Need to ensure the backend is robust to RTDS disconnects, actively monitors data age.

CONFIRMED DEFECTS
- Frontend mislabels outcome token prices as BTC.
- Missing staleness enforcement logic.

ROOT CAUSES
- `rtds.ts` is subscribing to the wrong topic (market vs chainlink) and endpoint.

NON-ISSUES
- The connection management structure (reconnecting after 5s) works as a base, but needs hardening for metrics and stale detection.

UNVERIFIED ASSUMPTIONS
- The exact endpoint URL and payload structure for the Chainlink RTDS endpoint on Polymarket.

DEPENDENCIES
- Polymarket Chainlink RTDS stream availability.

RISKS
- Rate limiting or connection instability on the live data stream.

IMPLEMENTATION CELLS
- 1. RTDS Connection & Subscription.
- 2. Stale Reference Lock & Metrics Tracking.
- 3. Shared Types & Server Broadcast Updates.
- 4. Frontend State & Disconnect Handling.

FILE OWNERSHIP
- Backend (`rtds.ts`, `routes/index.ts`)
- Shared (`index.ts`)
- Frontend (`App.tsx`, `useWebSocket.ts`)

SEQUENCE
1. Modify `packages/shared/src/index.ts` to enrich `RTDS_UPDATE` and add new types.
2. Refactor `rtds.ts` to connect to Chainlink and manage the stale lock metrics.
3. Update `routes/index.ts` to use the stale lock when placing orders.
4. Update frontend to reflect the new state, properly restoring upon reconnect.

ACCEPTANCE CRITERIA
- BTC price shown is the actual reference price, not token price.
- Stale data correctly triggers the stale lock, blocking trading actions.
- Disconnections are communicated to the frontend, disabling appropriate UI elements.
- Reconnections correctly restore the UI and data streams.

NEGATIVE TESTS
- Outcome-token price cannot be labelled BTC.
- Stale Chainlink blocks configured actions.
- Disconnect changes UI state and reconnect restores state.

REGRESSION TESTS
- Order placement still works when Chainlink is fresh.
- Subscriptions to outcome tokens are still handled correctly by the CLOB adapter if needed, separate from the Chainlink RTDS.

RUNTIME CHECKS
- Continuous data age monitoring to lock trading if data is stale.

ROLLBACK PLAN
- Revert `rtds.ts` and `routes/index.ts` to previous commits.
