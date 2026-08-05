# Scan Report: Phase 5 - Dynamic Maker-Preset Engine

## Investigation Focus
We searched the codebase for the current implementation of preset calculations, pricing buttons, and frontend event capture. 

## Findings
1. **Existing Preset Engine**: There is currently no preset calculation engine implemented. The database schema in `apps/server/src/db/index.ts` has a stub `presets` table, and `apps/server/src/routes/index.ts` has a dummy `GET /api/v1/presets` endpoint that returns an empty array. No types exist in the `shared` package for presets.
2. **Frontend UI**: `apps/extension/src/components/TradingPanel.tsx` uses manual inputs for `size` (USD) and `price` (cents). It features basic +1c/-1c buttons and predefined percentage buttons for size, but no dynamic maker-preset buttons based on reference prices.
3. **Execution Tracking**: The `TradingPanel.tsx` uses `onPointerDown` for the existing `Buy` and `Sell` buttons to trigger `handleTrade`. It already generates a `crypto.randomUUID()` client request ID and sends it as `id` in the `PLACE_ORDER` websocket payload. The backend `routes/index.ts` has an `idempotency` table and logic to prevent duplicate requests with the same `id`.
4. **Size Conversion Defect**: The requirement states "Buy size uses dollar size controls (backend converts USD to shares at the limit price). Sell size uses position % or shares." However, currently the backend `PaperTradingAdapter.ts` treats the incoming `size` value directly as shares, despite the frontend labeling the input as "Size (USD)" and calculating it based on USD balance percentage. 

## Summary
The codebase requires full implementation of the preset data model in `shared`, backend CRUD endpoints for presets, logic adjustments in order submission to handle USD-to-shares conversion, and a major rewrite of the `TradingPanel.tsx` to display dynamic preset buttons that react in real-time to reference prices and submit on `pointerdown`.
