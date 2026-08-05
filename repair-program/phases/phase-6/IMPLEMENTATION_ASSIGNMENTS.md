# Phase 6 Implementation Assignments

## Cell 1: Schema & Interface Updates
- Modify `packages/shared/src/index.ts` to include `orderType?: 'GTC' | 'FAK' | 'FOK'`.
- Modify `TradingAdapter.ts`, `PaperTradingAdapter.ts`, `RawTradingAdapter.ts` to include `orderType?: string`.
- Update `PlaceOrderSchema` in `apps/server/src/routes/index.ts`.

## Cell 2: Trading Error Implementation
- Create `apps/server/src/errors/TradingError.ts`.
- Wrap API errors in `OfficialSdkTradingAdapter.ts` with `TradingError`.
- Catch `TradingError` in `routes/index.ts` to emit specific structured `ERROR` events to WS.

## Cell 3: Live Order Placement
- Update `placeOrder` in `OfficialSdkTradingAdapter.ts` to use `@polymarket/clob-client-v2` `OrderType` maps based on `orderType` passed from WS.
- Map string amounts to correctly scaled float conversions matching Clob limits.

## Cell 4: Live WebSocket Order Sync
- Expand `this.wsUser.on('message')` to intercept `order_change`, `cancel`, or closed statuses and run the appropriate local DB updates (`UPDATE orders SET status = ...`).
- Ensure UI `ORDER_UPDATE` messages are propagated when a status changes via WS.

## Cell 5: Factory and Balances
- Adjust `apps/server/src/integrations/polymarket/adapters/index.ts` to prefer `OfficialSdkTradingAdapter` when `ENABLE_LIVE_TRADING=true`.
- Adjust `OfficialSdkTradingAdapter.getBalance()` to gracefully pull balance from Polygon RPC or fallback on failure.
