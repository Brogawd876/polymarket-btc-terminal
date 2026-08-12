# TEST_PLAN

## Scenario 1: Offline Fill Reconciliation
1. Start the backend with `ENABLE_LIVE_TRADING=true`.
2. Place a limit order on a live market via the frontend.
3. Observe the order in the SQLite `orders` table as `PENDING`.
4. Shut down the backend.
5. Fulfill the order on Polymarket directly (or wait for it to be hit).
6. Start the backend.
7. Observe the boot logs for reconciliation.
8. Verify that the SQLite `orders` table now shows `FILLED`.

## Scenario 2: Offline Cancel Reconciliation
1. Start the backend.
2. Place a limit order.
3. Shut down the backend.
4. Cancel the order on Polymarket manually.
5. Start the backend.
6. Verify that the SQLite `orders` table now shows `CANCELLED`.

## Scenario 3: Deduplication Key Recovery
1. Start backend and frontend.
2. Open Network tab in extension. Note a `PLACE_ORDER` payload ID.
3. Disconnect WebSocket and restart backend.
4. Attempt to send the exact same `PLACE_ORDER` payload (same ID).
5. Ensure the backend returns the original cached response from SQLite instead of placing a duplicate order.
