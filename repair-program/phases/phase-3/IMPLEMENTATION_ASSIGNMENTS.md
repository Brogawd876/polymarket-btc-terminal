# Implementation Assignments

## Backend / Server (`apps/server/src/integrations/polymarket/rtds.ts`, `routes/index.ts`)
1. **RTDS Chainlink Connection**:
   - Change `wss://ws-subscriptions-clob.polymarket.com/ws/market` to the correct Chainlink RTDS endpoint (e.g. `wss://ws-live-data.polymarket.com` with the `chainlink` topic or similar).
   - Implement logic to subscribe to the BTC/USD reference price filter.
   - Maintain the connection with proper ping/pong heartbeat, reconnecting as necessary.
2. **Metrics & Stale Lock**:
   - Track `source_timestamp`, `receive_timestamp`, `data_age`, `price_to_beat`, `current_value`, `difference`, and `leading_direction` in `rtds.ts`.
   - Create an exportable function `isRtdsStale()` that returns true if `data_age` exceeds a certain threshold (e.g. 1-2 seconds) or if the connection is down.
3. **Route Integration**:
   - In `routes/index.ts`, before processing `PLACE_ORDER`, check `isRtdsStale()`. If true, return an `ERROR` message indicating that trading is blocked due to stale reference price data.

## Shared (`packages/shared/src/index.ts`)
1. **Schema Updates**:
   - Update `RTDS_UPDATE` payload in `WsEventSchema` to include all new tracked metrics (`source_timestamp`, `data_age`, `current_value`, `stale`).
   - Add a new `RTDS_STATUS` event type (or use `RTDS_UPDATE` with a specific payload) to broadcast connection status so the frontend can react.

## Frontend (`apps/extension/src/components/App.tsx`, `useWebSocket.ts`)
1. **WebSocket Hook**:
   - Parse the enriched `RTDS_UPDATE` and new `RTDS_STATUS` events in `useWebSocket.ts`.
   - Manage state for `rtdsMetrics` and `rtdsConnected`.
2. **App UI**:
   - Remove the display of token prices as BTC prices.
   - Render the actual `rtdsMetrics.current_value` next to `BTC:`.
   - Update the UI visually (e.g., color changes, disabled buttons) when `rtdsConnected` is false or data is stale.
