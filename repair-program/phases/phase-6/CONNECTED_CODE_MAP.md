# Phase 6 Connected Code Map

- `packages/shared/src/index.ts`
  - Defines `WsEvent`, `OrderSchema`, `PlaceOrderSchema` payloads. Requires updates for `orderType`.

- `apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts`
  - Abstract base class. Needs `orderType?: string` on `placeOrder`.
  
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts`
  - Needs `orderType?: string` to match the new signature.
  
- `apps/server/src/integrations/polymarket/adapters/RawTradingAdapter.ts`
  - Needs `orderType?: string` to match the new signature.

- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`
  - The main implementation file. Will use `ClobClient.createOrder` with different `OrderType` enums based on `orderType`.
  - WS user channel needs to handle cancels and rejected orders.
  - API errors to be wrapped in a custom error.

- `apps/server/src/routes/index.ts`
  - WS `PLACE_ORDER` schema parser needs to allow `orderType`.
  - Passes `orderType` down to `adapter.placeOrder()`.

- `apps/server/src/integrations/polymarket/adapters/index.ts`
  - Factory logic must detect `ENABLE_LIVE_TRADING=true` and instantiate `OfficialSdkTradingAdapter` effectively.

- `apps/server/src/errors/TradingError.ts`
  - (New) Generic error wrapper for API calls to Polymarket CLOB.
