# Connected Code Map: Phase 5

## 1. Shared Types
- `packages/shared/src/index.ts`: Requires new schemas and types for `Preset`, `PresetMode`, `ReferenceSource`, and `MakerSafeBehavior`.

## 2. Backend Routes and Adapters
- `apps/server/src/routes/index.ts`: Add `GET`, `POST`, `PUT`, `DELETE` endpoints or websocket handlers for presets. Update `PLACE_ORDER` schema if size format changes or add conversion logic in the route before adapter.
- `apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts` (and implementations like `PaperTradingAdapter.ts`, `OfficialSdkTradingAdapter.ts`): Ensure order execution correctly interprets size. If `size` is USD for BUY, divide by limit price to get shares before executing.

## 3. Frontend Panel
- `apps/extension/src/components/TradingPanel.tsx`: Major UI update. Remove old manual buttons if needed, or add the new dynamic preset buttons. Implement the preset calculation engine inline or via a custom hook. Add logic to handle `CLAMP` and `DISABLE` modes based on current best bid/ask. Add UI to manage/reorder presets.

## 4. Database
- `apps/server/src/db/index.ts`: The `presets` table exists, but we need to ensure the schema (`id`, `name`, `config`) can serialize the new preset JSON configuration accurately.
