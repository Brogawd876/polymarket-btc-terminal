# Implementation Assignments: Phase 5

1. **Shared Package (`packages/shared/src/index.ts`)**:
   - Define `PresetMode` (PERCENT_OFFSET, CENT_OFFSET, ABSOLUTE_PRICE).
   - Define `ReferenceSource` (BEST_BID, BEST_ASK, MIDPOINT, LAST_TRADE).
   - Define `MakerSafeBehavior` (CLAMP, DISABLE).
   - Define `PresetConfig` schema.

2. **Backend API (`apps/server/src/routes/index.ts`)**:
   - Implement handlers for `/api/v1/presets` (GET, POST, PUT, DELETE) that interact with the `presets` table.
   - Inject default presets (15%, 20%, 50% offsets) into DB if none exist on startup.

3. **Order Execution Logic (`apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts` implementations)**:
   - Update adapter order parsing or the WS `PLACE_ORDER` handler to detect size type.
   - Implement conversion: `shares = USD_Size / limit_price` for BUY orders.
   - For SELL orders, implement a way to specify percentage of position or shares directly. This may require looking up the position in the DB before passing to adapter.

4. **Frontend UI (`apps/extension/src/components/TradingPanel.tsx`)**:
   - Build a `PresetEngine` function or hook that takes `marketInfo` and `PresetConfig[]` and outputs computed valid prices.
   - Implement logic for `CLAMP` mode (Buy max = best ask - 0.01, Sell min = best bid + 0.01).
   - Update UI to show dynamic buttons with precise live prices (e.g., `[34¢]`).
   - Wire up `onPointerDown` to dispatch `PLACE_ORDER` using the newly computed prices with existing UUID deduplication.
