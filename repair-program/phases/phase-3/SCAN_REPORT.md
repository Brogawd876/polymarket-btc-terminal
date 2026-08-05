# Phase 3 Scan Report

## Objective
Implement the actual BTC/USD Chainlink reference-price stream.
- Connect to correct Polymarket RTDS endpoint.
- Subscribe to the correct Chainlink topic and BTC/USD filters.
- Track metrics (source timestamp, receive timestamp, data age, current value).
- Implement Stale reference lock to block configured actions if data is stale.
- Prevent outcome token prices from being mislabeled as BTC price in the frontend.

## Findings
- **Incorrect Stream Endpoint**: `apps/server/src/integrations/polymarket/rtds.ts` connects to `wss://ws-subscriptions-clob.polymarket.com/ws/market` and subscribes to `type: 'market'` using `assets_ids`. This is the orderbook/CLOB websocket, not the Chainlink prices websocket.
- **Data Mislabeled**: `rtds.ts` incorrectly broadcasts these token updates as `RTDS_UPDATE`, which the frontend incorrectly assumes is the BTC reference price.
- **Frontend Display**: `apps/extension/src/components/App.tsx` directly displays `rtdsPrice` next to `BTC:`, which leads to the bug where outcome-token price is labelled as BTC.
- **Missing Staleness Check**: There is currently no logic that tracks data age or implements a stale reference lock. `apps/server/src/routes/index.ts` processes `PLACE_ORDER` without checking if the reference price is stale.

## Necessary Updates
- Refactor `rtds.ts` to connect to the proper Chainlink RTDS endpoint (e.g. Polymarket live data websocket) and filter for BTC/USD price ticks.
- Expose a stale lock mechanism from `rtds.ts` that can be queried by `routes/index.ts`.
- Update `packages/shared/src/index.ts` to include the enriched `RTDS_UPDATE` payload (if necessary) or at least ensure the value passed represents the true BTC price.
- Modify `routes/index.ts` to block trading actions if the stale lock is active.
