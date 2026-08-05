# SCAN_REPORT

## Context
Phase 7 focuses on preventing total loss of execution context if the terminal or browser crashes. Specifically, it involves:
- Syncing offline order fills/cancellations upon backend restart.
- Persisting and recovering idempotency (deduplication keys) and resting orders.
- Frontend triggering a full state sync upon reconnection.

## Findings
- **Order Persistence**: Order states are already persisted to the local SQLite DB (`orders` table). 
- **Paper Trading Recovery**: `PaperTradingAdapter` handles its own persistence and recovery by re-loading `PENDING` orders from the DB on startup.
- **Idempotency**: A SQLite table `idempotency` already persists deduplication keys and their cached responses. This completely satisfies the requirement to recover deduplication keys.
- **Frontend Sync**: The frontend `background.ts` actively requests a `SNAPSHOT_REQUEST` upon the WebSocket successfully authenticating (`AUTH_OK`).
- **Live Trading Reconcilation**: In `OfficialSdkTradingAdapter.ts`, the initialization performs a call to `getOpenOrders()` but it simply logs the length. It does not update the local database with missed offline fills or cancellations.
- **Positions Logic**: `GET /api/positions` computes position sizes/prices using the `orders` table directly instead of aggregating actual `fills`. However, for the scope of Phase 7, the core gap is the missing reconciliation logic in `OfficialSdkTradingAdapter`.

## Deductions
- The majority of the Phase 7 requirements are fundamentally in place but the live `OfficialSdkTradingAdapter` lacks the reconciliation loop.
- By matching the returned `OpenOrders` from Polymarket against SQLite's resting orders (`status IN ('PENDING', 'OPEN', 'NEW')`), the backend can identify missing orders.
- For missing orders, `clobClient.getOrder(id)` can be queried to confirm if they were `FILLED` or `CANCELLED`, updating the DB accordingly.
