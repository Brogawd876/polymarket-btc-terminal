# CONNECTED_CODE_MAP

## Frontend (Extension)
- `apps/extension/src/entrypoints/background.ts`
  - Reconnects WebSocket on drop.
  - Authenticates.
  - Sends `SNAPSHOT_REQUEST` upon successful auth.
- `apps/extension/src/hooks/useWebSocket.ts`
  - Receives `SNAPSHOT` payload to sync `orders`, `positions`, `settings`.

## Backend (Server)
- `apps/server/src/db/index.ts`
  - Defines SQLite schema.
  - `orders`, `fills`, `positions`, `idempotency`.
- `apps/server/src/routes/index.ts`
  - Handles `PLACE_ORDER`, storing deduplication keys in `idempotency`.
  - Handles `SNAPSHOT_REQUEST`, querying the `orders` and `positions` tables.
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`
  - Implements live Polymarket interaction.
  - `initialize()` is responsible for boot tasks but is missing the reconciliation logic.
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts`
  - Simulated trading.
  - Properly loads unfulfilled orders from SQLite on start.
