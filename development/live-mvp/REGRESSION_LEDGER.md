# Live MVP Regression Ledger

## Regression Prevention Tracking
- **Schema Backward Compatibility**: Shared Zod schemas must preserve mandatory field validation and reject untyped payloads.
- **WebSocket Reconnection Security**: Reconnections must require valid local auth token re-handshake before accepting commands.
- **Execution Safeguards**: Disarmed state, stale RTDS price feed (>5s), or invalid market reference must hard-block order placement on both extension and Fastify backend.
- **Position Accounting Integrity**: Net position shares and average entry price must be derived strictly from `fills` transactions, never from unconfirmed `orders`.
- **Database Persistence**: SQLite database schema must use WAL mode and atomic transactions for idempotency reservations and order updates.
