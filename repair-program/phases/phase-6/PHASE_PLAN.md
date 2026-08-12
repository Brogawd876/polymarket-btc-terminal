# Phase 6 Plan

## PHASE ID
Phase 6

## PHASE OBJECTIVE
Implement real Polymarket authentication and order-signing (the live `OfficialSdkTradingAdapter`).

## BASELINE COMMIT
TBD

## CURRENT BEHAVIOR
- The `OfficialSdkTradingAdapter` is a partial stub that reads `PRIVATE_KEY` and sets up a wallet.
- `placeOrder` only supports limit orders (`postOnly: true`). FAK (Fill And Kill) and FOK (Fill Or Kill) are not supported.
- `TradingAdapter` interface and `PLACE_ORDER` schema do not support an `orderType` argument.
- REST API errors are thrown as plain `Error` objects containing string messages.
- The WebSocket handler only processes `fill` events, ignoring order cancellations and other states.
- `createTradingAdapter` factory prioritizes `TRADING_MODE` over `ENABLE_LIVE_TRADING`, which might lead to incorrect mode selection.

## TARGET BEHAVIOR
- `OfficialSdkTradingAdapter` will securely load `PRIVATE_KEY` and initialize the wallet, failing gracefully if disabled or missing.
- `placeOrder` will support `orderType` (GTC, FAK, FOK), appropriately passing it to the ClobClient.
- API errors will be caught and mapped to a new `TradingError` envelope with standardized codes.
- WebSocket listeners will handle both `fill` and `cancel`/closed state events, correctly updating the local DB and broadcasting changes.
- Balances will be managed via real blockchain reads on the Polygon RPC (configurable via env).
- Setting `ENABLE_LIVE_TRADING=true` will automatically drop the backend into the live SDK adapter unless explicitly overridden by `TRADING_MODE=paper`.

## TARGET FILES
- `packages/shared/src/index.ts`
- `apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/RawTradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/index.ts`
- `apps/server/src/routes/index.ts`
- `apps/server/src/errors/TradingError.ts` (New file)

## CONNECTED FILES
- `apps/server/.env.example`
- `apps/server/src/db/index.ts`

## CALLERS
- WebSocket client (frontend) dispatching `PLACE_ORDER` and `CANCEL_ORDER`.

## CALLEES
- Polymarket ClobClient API (`@polymarket/clob-client-v2`).
- Polygon RPC node for balance checks.

## SHARED CONTRACTS
- `packages/shared/src/index.ts` (OrderSchema, WsEvent schemas).

## ENVIRONMENT VARIABLES
- `PRIVATE_KEY`
- `ENABLE_LIVE_TRADING`
- `TRADING_MODE`
- `POLYGON_RPC_URL` (optional, for balance queries)

## DATABASE IMPACT
- Orders table will see state changes triggered directly by WS messages (e.g. status becoming `CANCELLED` or `FILLED`).

## FRONTEND IMPACT
- UI will send `orderType` with `PLACE_ORDER` requests.
- UI will receive structured error messages if orders fail due to API limits or rejection.

## BACKEND IMPACT
- Backend order placement logic will map FAK/FOK to ClobClient structures.
- Structured `TradingError` handling across routes and WS.

## TEST IMPACT
- Need to unit test `OfficialSdkTradingAdapter` to ensure it formats `ClobClient.createOrder` correctly based on `orderType`.

## OPERATIONS IMPACT
- Users need to be warned that real USDC.e will be consumed if `ENABLE_LIVE_TRADING=true` and a valid private key is provided.

## CONFIRMED DEFECTS
- Missing FAK/FOK support in the system architecture.
- Incomplete WS event processing in `OfficialSdkTradingAdapter`.

## ROOT CAUSES
- Polymarket CLOB integration was left as a stub in previous phases to favor paper trading logic.

## NON-ISSUES
- N/A

## UNVERIFIED ASSUMPTIONS
- Polymarket WS `user` channel broadcasts standard `order_change` or similar events for cancels. Will need to inspect WS messages or adapt the rest API polling if WS doesn't emit cancels.

## DEPENDENCIES
- `clob-client-v2`
- `ethers` v5 (as currently used in the codebase)

## RISKS
- Live funds will be at risk. Real USDC.e will be used.
- API keys might get exposed if logging is not careful. Ensure no logging of the `PRIVATE_KEY` or derived API key secret.

## IMPLEMENTATION CELLS
1. **Schema Expansion**: Add `orderType` to `shared/src/index.ts` and `PlaceOrderSchema` in `routes/index.ts`.
2. **Adapter Interfaces**: Update `TradingAdapter.ts`, `PaperTradingAdapter.ts`, and `RawTradingAdapter.ts` to accept `orderType`.
3. **Trading Error Class**: Create `TradingError.ts` and update `OfficialSdkTradingAdapter.ts` to wrap ClobClient errors.
4. **Live Order Types**: Implement FAK, FOK, and GTC logic in `OfficialSdkTradingAdapter.placeOrder`.
5. **Live WS Sync**: Expand `wsUser.on('message')` in `OfficialSdkTradingAdapter` to handle order cancellation and status updates.
6. **Factory Logic**: Update `adapters/index.ts` to seamlessly prioritize `sdk` mode when `ENABLE_LIVE_TRADING=true`.

## FILE OWNERSHIP
- Backend / Integrations

## SEQUENCE
1. Schema Expansion
2. Trading Error Class
3. Adapter Interfaces
4. Factory Logic
5. Live Order Types
6. Live WS Sync

## ACCEPTANCE CRITERIA
- `ENABLE_LIVE_TRADING=true` automatically uses `OfficialSdkTradingAdapter` unless overridden.
- API errors are returned in a generic envelope structure.
- User can place FAK and FOK orders.
- UI receives real-time WS updates when a live order is cancelled via API.

## NEGATIVE TESTS
- What happens if `PRIVATE_KEY` is invalid or unfunded? Should fail gracefully with `TradingError`.
- What happens if ClobClient throws a random 500 error? Should be wrapped as an internal error but still exposed via WS ERROR event.

## REGRESSION TESTS
- Paper trading must continue to work normally if `ENABLE_LIVE_TRADING=false`.

## RUNTIME CHECKS
- Validate `ethers.Wallet` initialization.

## ROLLBACK PLAN
- Revert changes to `OfficialSdkTradingAdapter` and rely on paper trading.
