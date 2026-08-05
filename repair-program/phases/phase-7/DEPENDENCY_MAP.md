# DEPENDENCY_MAP

## Internal
- `db/index.ts` (Database) is central to all state recovery mechanisms.
- `TradingAdapter` interface dictates how adapters boot (`initialize()`).

## External
- `@polymarket/clob-client-v2` (`clobClient`)
  - `getOpenOrders()`: Retrieves currently active orders.
  - `getOrder(id)`: Retrieves historical/status info for an individual order.
