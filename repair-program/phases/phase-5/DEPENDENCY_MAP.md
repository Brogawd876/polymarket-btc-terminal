# Dependency Map: Phase 5

## External Dependencies
No new external libraries are required for this phase. Existing Zod validations and React hooks are sufficient.

## Internal Dependencies
- The dynamic preset engine relies on the `MARKET_UPDATE` websocket messages providing real-time `bestBid`, `bestAsk`, and `midpoint`.
- The deduplication mechanism relies on the `idempotency` database table which is already set up and functional.
- The size conversion logic requires the backend to differentiate between USD size and Share size depending on the `side` (BUY vs SELL) during order submission.
