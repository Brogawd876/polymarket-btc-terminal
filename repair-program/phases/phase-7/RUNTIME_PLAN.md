# RUNTIME_PLAN

## Startup Sequence Updates
- When `index.ts` calls `adapter.initialize()`:
  - If `ENABLE_LIVE_TRADING=true`, `OfficialSdkTradingAdapter` initializes `clobClient`.
  - Performs `getOpenOrders()`.
  - Performs database queries on the `orders` table.
  - Sequentially queries `getOrder()` for any offline-mutated orders.
  - Updates DB state before resolving `initialize()`.
  
## Error Handling
- If `clobClient.getOrder(id)` throws an error (e.g., rate limit or network error), the adapter will default the missing order to `CANCELLED` locally to ensure it is cleared from active tracking. Alternatively, if we suspect intermittent failure, log error but do not update status (though this risks zombie orders). The recommended approach is to mark it as `CANCELLED`.
  
## Memory / Performance
- Fetching `getOpenOrders()` happens once at boot.
- Polling `getOrder(id)` is limited to only the discrepancy count (expected to be small on any typical restart).
- `SQLite` queries execute synchronously and immediately.

## Rollback
- If the reconciliation logic causes startup failures (e.g., API structure changed), we can revert `OfficialSdkTradingAdapter.ts` to just ignoring the results of `getOpenOrders()` as it previously did.
