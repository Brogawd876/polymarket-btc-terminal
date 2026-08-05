PHASE ID: 7
PHASE OBJECTIVE: Prevent total loss of execution context if the terminal or browser crashes.

BASELINE COMMIT: (current)

CURRENT BEHAVIOR:
- `OfficialSdkTradingAdapter` initializes but does not reconcile resting orders from SQLite with actual open orders from the Polymarket API.
- Offline fills and cancellations in live trading are ignored on boot.
- The UI properly requests a `SNAPSHOT` sync on reconnect.
- `idempotency` keys and deduplication logic are already correctly implemented and persisted in SQLite.

TARGET BEHAVIOR:
- `OfficialSdkTradingAdapter.initialize()` performs a strict reconciliation sync.
- It will compare Polymarket's open orders (`clobClient.getOpenOrders()`) against SQLite's resting orders (`status IN ('PENDING', 'OPEN', 'NEW')`).
- If an order is missing from Polymarket's open orders, it will fetch the order details via `getOrder(id)` and update the database status to `FILLED` or `CANCELLED`.
- Still-resting orders will remain active.
- Idempotency keys are naturally recovered since they reside in the SQLite `idempotency` table.
- The UI continues to pull a full state sync upon connection.

TARGET FILES:
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`

CONNECTED FILES:
- `apps/server/src/db/index.ts`
- `apps/server/src/routes/index.ts`
- `apps/extension/src/entrypoints/background.ts`

CALLERS:
- `apps/server/src/index.ts` calls `adapter.initialize()`

CALLEES:
- `clobClient.getOpenOrders()`
- `clobClient.getOrder(id)`
- `db.prepare(...)`

SHARED CONTRACTS:
- `Order` / `MarketState` (shared types)

ENVIRONMENT VARIABLES:
- `ENABLE_LIVE_TRADING`

DATABASE IMPACT:
- Safely reconciles `orders` table status (`FILLED`, `CANCELLED`, `OPEN`).

FRONTEND IMPACT:
- No changes required; the frontend will naturally receive the correctly reconciled state when it pulls the `SNAPSHOT`.

BACKEND IMPACT:
- Boot sequence will fetch the exact status of orders that were active before a crash.

TEST IMPACT:
- Need to verify that missing orders from `getOpenOrders()` are accurately tagged as `FILLED` or `CANCELLED`.

OPERATIONS IMPACT:
- Safely resume execution with correct status post-crash.

CONFIRMED DEFECTS:
- Offline order fills/cancellations are completely missed in live trading.

ROOT CAUSES:
- Missing sync logic in `OfficialSdkTradingAdapter.ts` boot sequence.

NON-ISSUES:
- Paper Trading already recovers resting orders from the DB on startup.
- Deduplication keys are already persisted in the `idempotency` SQLite table.
- Frontend already pulls a state snapshot upon WS connection.

UNVERIFIED ASSUMPTIONS:
- `getOrder` API endpoint returns sufficient information to deduce if an order was matched. (If `size_matched` >= `original_size` or status is explicit, we deduce `FILLED`).

DEPENDENCIES:
- `clob-client-v2` for `getOrder` API.

RISKS:
- `getOrder` rate limits if there are hundreds of resting orders to check on boot. Mitigation: only call `getOrder` for orders that were expected to be open but are missing from `getOpenOrders()`.

IMPLEMENTATION CELLS:
- **Cell 1**: Update `OfficialSdkTradingAdapter.initialize()` to reconcile SQLite resting orders with `getOpenOrders()`. Identify missing orders, fetch them via `getOrder()`, and update DB `status` accordingly.

FILE OWNERSHIP:
- `OfficialSdkTradingAdapter.ts` (Backend)

SEQUENCE:
1. Fetch `getOpenOrders()` from Polymarket.
2. Query DB for resting orders.
3. Identify missing orders.
4. Fetch details for missing orders.
5. Update DB status.

ACCEPTANCE CRITERIA:
- Restarting the backend while an order is filled offline results in the database showing `FILLED` on boot.
- Restarting the backend while an order is cancelled offline results in the database showing `CANCELLED` on boot.
- Reconnecting the frontend fetches the correct, updated state.

NEGATIVE TESTS:
- What if `getOrder` fails due to 404? Default to `CANCELLED` to avoid being stuck as `PENDING`.

REGRESSION TESTS:
- Ensure order placement still works.
- Ensure paper trading still recovers normally.

RUNTIME CHECKS:
- Log reconciliation stats on boot (e.g., "Reconciled X filled, Y cancelled, Z resting").

ROLLBACK PLAN:
- Remove the reconciliation loop from `initialize()` and revert to the simple log statement.
