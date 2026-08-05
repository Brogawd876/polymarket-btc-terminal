# Phase 6 Scan Report

## File Analysis
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`: Exists as a partial implementation. Supports `postOnly` limit orders, reads `PRIVATE_KEY`, handles WS fills.
- `apps/server/src/integrations/polymarket/adapters/index.ts`: The factory currently returns `PaperTradingAdapter` if `ENABLE_LIVE_TRADING !== 'true'`, but might return `RawTradingAdapter` if mode is set to raw, ignoring live intent.
- `packages/shared/src/index.ts`: Missing `orderType` in schemas.
- `apps/server/src/routes/index.ts`: Hardcodes WS order processing without passing an `orderType`.

## Findings
- Security: `PRIVATE_KEY` is loaded from `process.env` and immediately deleted. This prevents accidental exposure in other parts of the app.
- Defect: `placeOrder` signature does not support order types.
- Defect: `OfficialSdkTradingAdapter` error handling does not format errors, throwing string-based `Error` instead.
- Defect: `OfficialSdkTradingAdapter` WS does not handle cancel events.

## Actionable Insights
- FAK and FOK need to be translated to `@polymarket/clob-client-v2` `OrderType.FAK` and `OrderType.FOK`.
- We must define a new `TradingError` class for internal backend error mapping, to provide clean codes to the frontend WS client.
