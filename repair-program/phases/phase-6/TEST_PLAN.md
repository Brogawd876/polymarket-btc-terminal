# Phase 6 Test Plan

## Unit Tests
1. **Schema Validation**: Verify `PlaceOrderSchema` successfully parses payload with `orderType: 'FAK'`.
2. **Adapter Method Map**: Mock `ClobClient.createOrder` and assert that passing `orderType: 'FOK'` produces an `orderArgs` object containing `OrderType.FOK`.
3. **Error Mapping**: Throw a mock API rejection and verify that `placeOrder` catches it, throwing a `TradingError` with the parsed Polymarket message.
4. **WebSocket Sync**: Mock a WS `order_change` or `cancel` message into `handleMarketMessage`/`handleUserMessage` and verify a db `UPDATE orders SET status='CANCELLED'` occurs.

## Integration Tests
1. **Adapter Factory**: Test that `createTradingAdapter()` returns an instance of `OfficialSdkTradingAdapter` when `ENABLE_LIVE_TRADING=true`.
2. **Wallet Initialization**: Validate that missing `PRIVATE_KEY` on boot when `ENABLE_LIVE_TRADING=true` causes an immediate initialization failure.

## E2E Flows
1. **Submit Live Limit Order**: With a small test sum, submit a GTC limit order deeply out of money, verify placement, check `PENDING` state on UI, then manually cancel via UI, verify `CANCELLED` state.
2. **FAK Execution**: Submit a FAK order, verify it either fills immediately or automatically moves to `CANCELLED`/`REJECTED` state instantly without hanging.
