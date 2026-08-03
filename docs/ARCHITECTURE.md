# Architecture: Local Polymarket BTC 5-Minute Execution Terminal

## System Boundaries
The system consists of two primary boundaries:
1. **Browser Extension (WXT/Shadow DOM)**: Handles UI injection into Polymarket, intercepts pointer-down events for latency-free price capture, and sends execution commands.
2. **Local Node.js Backend**: Maintains SQLite persistence, manages WebSocket connections, and proxies API requests.

## Runtime Data Flow
1. **Price Capture**: Extension listens for pointer-down events, captures the price locally, and dispatches a message to the backend via WebSocket.
2. **Order Execution**: Backend receives the request, stores a `PENDING` order in SQLite, and fires the API request to the external market.
3. **State Sync**: Backend listens to external WebSockets for fills/updates, updates SQLite, and pushes `ORDER_UPDATE` to the Extension.

## Dependency Boundaries
- `@polymarket-btc/shared`: Pure TS (Zod schemas, types). Imported by both Extension and Backend.
- `@polymarket-btc/backend`: Node.js, SQLite (better-sqlite3), ws.
- `@polymarket-btc/extension`: WXT, React (if any UI), injected exclusively into Polymarket.

## Traceability Matrix
- **Requirement 1**: One-tap order execution
  - **Component**: Extension UI (Pointer-down listener) -> Backend API
  - **Tests**: Playwright pointer-down event capture, backend rapid-click deduplication.
- **Requirement 2**: Stale-data blocking
  - **Component**: Backend WebSocket Sync -> Local State
  - **Tests**: WebSocket stream mock with delayed timestamps, ensuring backend rejects orders.
- **Requirement 3**: SQLite Persistence
  - **Component**: Backend database
  - **Tests**: Restart tests verifying open orders and fills survive reboot.
