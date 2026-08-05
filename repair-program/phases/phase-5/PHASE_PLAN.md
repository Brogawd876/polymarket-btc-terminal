PHASE ID
Phase 5

PHASE OBJECTIVE
Implement the dynamic maker-preset engine (the principal product feature) with modes, maker-safe clamping, real-time live button pricing, one-tap execution via pointerdown, and proper USD-to-shares size conversion.

BASELINE COMMIT
Unknown

CURRENT BEHAVIOR
- No preset configuration exists.
- TradingPanel uses manual input boxes for price and size with simple +1c/-1c adjustments.
- Size input is labeled as "Size (USD)" but the backend directly parses this as "shares" without conversion for BUY orders.
- Only a single Buy/Sell button exists per token.

TARGET BEHAVIOR
- At least 5 buy and 5 sell preset buttons display exact computed prices dynamically based on configuration (PERCENT_OFFSET, CENT_OFFSET, ABSOLUTE_PRICE) and reference sources (BEST_BID, BEST_ASK, MIDPOINT, LAST_TRADE).
- Presets enforce Maker-Safe Behavior: Clamp (Buy max = ask - 1, Sell min = bid + 1) or Disable.
- Users can click any dynamically priced button to submit a deduplicated order immediately on `pointerdown`.
- Backend converts USD sizes to shares based on the limit price for BUY orders. SELL orders use position % or shares directly.

TARGET FILES
- `packages/shared/src/index.ts`
- `apps/server/src/routes/index.ts`
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts`
- `apps/extension/src/components/TradingPanel.tsx`

CONNECTED FILES
- `apps/server/src/db/index.ts`

CALLERS
- Frontend user interacting with the TradingPanel buttons.

CALLEES
- Backend WebSocket endpoints (`PLACE_ORDER`, presets CRUD if via WS).
- TradingAdapter `placeOrder` method.

SHARED CONTRACTS
- Added Zod schemas for `PresetConfig`, `PresetMode`, etc., to `@polymarket-btc/shared`.
- Update to `PLACE_ORDER` payload specification regarding size units (USD for BUY, Shares/% for SELL).

ENVIRONMENT VARIABLES
- None added.

DATABASE IMPACT
- Use the existing `presets` table to store serialized user configurations. No migration needed.

FRONTEND IMPACT
- High impact. Redesign of order entry to focus on the dynamic preset buttons. Real-time reactivity must calculate prices every time `marketInfo` updates without causing UI lag.

BACKEND IMPACT
- Moderate impact. Addition of presets CRUD operations and updates to the order execution path to handle USD-to-shares calculations for BUYs.

TEST IMPACT
- Need unit tests for preset calculation logic (e.g., offsets, clamping limits).
- Test USD-to-share conversion logic during order placement.

OPERATIONS IMPACT
- None.

CONFIRMED DEFECTS
- Currently, USD sizes are passed to the `PaperTradingAdapter` and treated identically to shares. A $100 size order for a $0.50 asset results in a 100 share order costing $50, not a 200 share order.

ROOT CAUSES
- The adapter takes the `size` string and uses it directly as `remainingSize` in shares, lacking context of whether it represents fiat value.

NON-ISSUES
- Idempotency is already handled correctly via the UUID client request ID in the WS handler.

UNVERIFIED ASSUMPTIONS
- Assuming "position % or shares" for SELL implies the frontend might send a payload indicating units, or we must fetch the user's position size and calculate shares on the backend before submitting.

DEPENDENCIES
- Requires real-time market orderbook data to calculate BEST_BID and BEST_ASK.

RISKS
- Calculation errors in preset offsets could submit orders at highly unfavorable prices. Maker-safe clamping must be strictly tested.
- Precision errors converting USD to shares (must round down to valid tick sizes or integer shares).

IMPLEMENTATION CELLS
- Add Preset Types to Shared
- Implement Presets API & DB storage
- Backend Size Conversion Logic
- Frontend Preset Calculation Engine & UI

FILE OWNERSHIP
- @polymarket-btc/shared: Shared definitions.
- @polymarket-btc/server: Backend API and execution logic.
- @polymarket-btc/extension: Trading panel frontend.

SEQUENCE
1. Add shared types.
2. Implement backend presets management and size conversion fix.
3. Implement frontend calculation engine and dynamic buttons.

ACCEPTANCE CRITERIA
- 5 Buy / 5 Sell presets are visible and configurable.
- Buttons display live prices (e.g. `[34¢]`).
- Clamping prevents crossing the spread by default.
- Clicking a button on `pointerdown` submits the exact displayed price.
- Buying with $100 at $0.50 calculates as 200 shares.

NEGATIVE TESTS
- Try to execute a clamped preset when the spread is 1 tick (should disable or clamp to not cross).
- Try to use a percentage offset on a 99c price (should clamp).

REGRESSION TESTS
- Manual sizing still works if retained.
- Duplicate clicks do not submit multiple orders.

RUNTIME CHECKS
- Size limits validate correctly post-conversion.

ROLLBACK PLAN
- Revert commits to TradingPanel and routes if presets cause execution failures.
